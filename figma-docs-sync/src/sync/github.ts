// sync/github: thin GitHub Git Data API client. No Figma dependency; `fetch` is injected so
// it can run in the plugin UI iframe and in tests against a fake server.
import { encodeBase64, decodeBase64 } from "./base64";

export type GitHubConfig = {
  owner: string;
  repo: string;
  branch: string;
  /** Never logged, never put in error messages. */
  token: string;
  fetch?: typeof fetch;
  apiBase?: string;
};

export type GitHubErrorKind = "auth" | "permission" | "approval" | "notfound" | "ratelimit" | "empty" | "network" | "protected" | "other";

export class GitHubError extends Error {
  constructor(
    message: string,
    public kind: GitHubErrorKind,
    public status?: number,
    /** ratelimit only: minutes until GitHub accepts requests again */
    public retryMinutes?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** The branch moved between reading it and updating it. */
export class BranchMovedError extends Error {
  constructor() {
    super("The branch changed on GitHub while syncing.");
    this.name = "BranchMovedError";
  }
}

export type TreeEntry = { path: string; mode: "100644"; type: "blob"; sha: string | null };

export class GitHubClient {
  private f: typeof fetch;
  private base: string;
  constructor(private cfg: GitHubConfig, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
    this.f = cfg.fetch ?? ((...a) => fetch(...a));
    this.base = cfg.apiBase ?? "https://api.github.com";
  }

  private repoUrl(p: string): string {
    const { owner, repo } = this.cfg;
    return `${this.base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${p}`;
  }

  /** Expiry of the token, from the last response (fine-grained tokens with an expiry only). */
  tokenExpires?: Date;

  private async request<T>(method: string, path: string, body?: unknown, opts: { raw422?: boolean } = {}): Promise<T> {
    const delays = [500, 1500];
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.f(this.repoUrl(path), {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.cfg.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (attempt < delays.length) {
          await this.sleep(delays[attempt]);
          continue;
        }
        throw new GitHubError("Could not reach GitHub (network error). Check your connection and try again.", "network");
      }
      if (res.status >= 500 && attempt < delays.length) {
        await this.sleep(delays[attempt]);
        continue;
      }
      // e.g. "2026-02-25 12:00:00 UTC"
      const exp = Date.parse((res.headers.get("github-authentication-token-expiration") ?? "").replace(" UTC", "Z").replace(" ", "T"));
      if (!isNaN(exp)) this.tokenExpires = new Date(exp);
      if (res.ok) return (await res.json()) as T;
      if (res.status === 422 && opts.raw422) {
        const msg = await res.clone().json().then((j: { message?: string }) => j.message ?? "", () => "");
        if (/protected/i.test(msg)) throw new GitHubError("This branch is protected. GitHub blocks direct saves to it.", "protected", 422);
        throw new BranchMovedError();
      }
      throw await this.toError(res);
    }
  }

  private async toError(res: Response): Promise<GitHubError> {
    let msg = "";
    try {
      msg = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* ignore */
    }
    const s = res.status;
    if (s === 401) return new GitHubError("GitHub rejected the token (401). It may be wrong or expired.", "auth", s);
    if ((s === 403 || s === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(msg) || s === 429)) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const retry = Number(res.headers.get("retry-after"));
      const mins = retry ? Math.ceil(retry / 60) : reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : undefined;
      return new GitHubError("GitHub rate limit reached. Wait a few minutes and try again.", "ratelimit", s, mins);
    }
    if (s === 403 && /approv/i.test(msg))
      return new GitHubError("An owner of your organisation must approve this token before it works.", "approval", s);
    if (s === 403)
      return new GitHubError(
        "The token is not allowed to do this (403). It needs 'Contents: Read and write' on this repository.",
        "permission",
        s,
      );
    if (s === 404)
      return new GitHubError(
        "Repository or branch not found, or the token has no access to it (404). Check owner, repo, branch and token.",
        "notfound",
        s,
      );
    if (s === 409 && /empty/i.test(msg))
      return new GitHubError("The repository is empty. Create an initial commit (e.g. a README) on the branch first.", "empty", s);
    return new GitHubError(`GitHub error ${s}${msg ? `: ${msg}` : ""}`, "other", s);
  }

  /**
   * Connection test: the repo is visible and the token can write Contents. Writing an unreferenced
   * blob is the only side-effect-free write GitHub offers (it is garbage-collected).
   */
  async checkRepo(opts: { write?: boolean } = { write: true }): Promise<{ defaultBranch: string; archived: boolean }> {
    const r = await this.request<{ default_branch: string; archived?: boolean }>("GET", "");
    if (opts.write && !r.archived) await this.createBlob(new Uint8Array(0));
    return { defaultBranch: r.default_branch, archived: !!r.archived };
  }

  async branchExists(branch: string): Promise<boolean> {
    try {
      await this.request("GET", `/git/ref/heads/${encodePathSegments(branch)}`);
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.kind === "notfound") return false;
      throw e;
    }
  }

  /** Create `branch` (this client's branch) from the head of `from`. */
  async createBranch(from: string): Promise<void> {
    const ref = await this.request<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodePathSegments(from)}`);
    await this.request("POST", "/git/refs", { ref: `refs/heads/${this.cfg.branch}`, sha: ref.object.sha });
  }

  async getHead(): Promise<{ commitSha: string; treeSha: string }> {
    const ref = await this.request<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodePathSegments(this.cfg.branch)}`);
    const commit = await this.request<{ tree: { sha: string } }>("GET", `/git/commits/${ref.object.sha}`);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  /** All files under `folder` (repo-root-relative paths -> blob sha). */
  async getFilesUnder(treeSha: string, folder: string): Promise<Record<string, string>> {
    const segs = folder.split("/").filter(Boolean);
    let sha = treeSha;
    for (const seg of segs) {
      const t = await this.request<{ tree: { path: string; type: string; sha: string }[] }>("GET", `/git/trees/${sha}`);
      const next = t.tree.find((e) => e.path === seg && e.type === "tree");
      if (!next) return {};
      sha = next.sha;
    }
    const t = await this.request<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
      "GET",
      `/git/trees/${sha}?recursive=1`,
    );
    if (t.truncated)
      throw new GitHubError("The docs folder is too large to list from GitHub. Use a dedicated docs folder.", "other");
    const out: Record<string, string> = {};
    const prefix = segs.length ? segs.join("/") + "/" : "";
    for (const e of t.tree) if (e.type === "blob") out[prefix + e.path] = e.sha;
    return out;
  }

  async getBlobText(sha: string): Promise<string> {
    const b = await this.request<{ content: string; encoding: string }>("GET", `/git/blobs/${sha}`);
    if (b.encoding !== "base64") throw new GitHubError("Unexpected blob encoding from GitHub.", "other");
    return new TextDecoder().decode(decodeBase64(b.content));
  }

  async createBlob(bytes: Uint8Array): Promise<string> {
    const r = await this.request<{ sha: string }>("POST", "/git/blobs", { content: encodeBase64(bytes), encoding: "base64" });
    return r.sha;
  }

  async createTree(baseTree: string, entries: TreeEntry[]): Promise<string> {
    const r = await this.request<{ sha: string }>("POST", "/git/trees", { base_tree: baseTree, tree: entries });
    return r.sha;
  }

  async createCommit(message: string, tree: string, parent: string): Promise<{ sha: string; url: string }> {
    const r = await this.request<{ sha: string; html_url?: string }>("POST", "/git/commits", { message, tree, parents: [parent] });
    const { owner, repo } = this.cfg;
    return { sha: r.sha, url: r.html_url ?? `https://github.com/${owner}/${repo}/commit/${r.sha}` };
  }

  /** Fast-forward only (force: false). Throws BranchMovedError if the branch moved. */
  async updateRef(sha: string): Promise<void> {
    await this.request("PATCH", `/git/refs/heads/${encodePathSegments(this.cfg.branch)}`, { sha, force: false }, { raw422: true });
  }
}

function encodePathSegments(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}
