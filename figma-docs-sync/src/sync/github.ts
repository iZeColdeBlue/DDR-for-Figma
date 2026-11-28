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

export type GitHubErrorKind = "auth" | "permission" | "notfound" | "ratelimit" | "empty" | "network" | "other";

export class GitHubError extends Error {
  constructor(
    message: string,
    public kind: GitHubErrorKind,
    public status?: number,
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
      if (res.ok) return (await res.json()) as T;
      if (res.status === 422 && opts.raw422) throw new BranchMovedError();
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
    if (s === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(msg)))
      return new GitHubError("GitHub rate limit reached. Wait a few minutes and try again.", "ratelimit", s);
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
