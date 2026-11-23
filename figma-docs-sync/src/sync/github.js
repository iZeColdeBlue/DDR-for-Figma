// sync/github: thin GitHub Git Data API client. No Figma dependency; `fetch` is injected so
// it can run in the plugin UI iframe and in tests against a fake server.
import { encodeBase64, decodeBase64 } from "./base64";
export class GitHubError extends Error {
    constructor(message, kind, status) {
        super(message);
        this.kind = kind;
        this.status = status;
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
export class GitHubClient {
    constructor(cfg, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
        this.cfg = cfg;
        this.sleep = sleep;
        this.f = cfg.fetch ?? ((...a) => fetch(...a));
        this.base = cfg.apiBase ?? "https://api.github.com";
    }
    repoUrl(p) {
        const { owner, repo } = this.cfg;
        return `${this.base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${p}`;
    }
    async request(method, path, body, opts = {}) {
        const delays = [500, 1500];
        for (let attempt = 0;; attempt++) {
            let res;
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
            }
            catch {
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
            if (res.ok)
                return (await res.json());
            if (res.status === 422 && opts.raw422)
                throw new BranchMovedError();
            throw await this.toError(res);
        }
    }
    async toError(res) {
        let msg = "";
        try {
            msg = (await res.json()).message ?? "";
        }
        catch {
            /* ignore */
        }
        const s = res.status;
        if (s === 401)
            return new GitHubError("GitHub rejected the token (401). It may be wrong or expired.", "auth", s);
        if (s === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(msg)))
            return new GitHubError("GitHub rate limit reached. Wait a few minutes and try again.", "ratelimit", s);
        if (s === 403)
            return new GitHubError("The token is not allowed to do this (403). It needs 'Contents: Read and write' on this repository.", "permission", s);
        if (s === 404)
            return new GitHubError("Repository or branch not found, or the token has no access to it (404). Check owner, repo, branch and token.", "notfound", s);
        if (s === 409 && /empty/i.test(msg))
            return new GitHubError("The repository is empty. Create an initial commit (e.g. a README) on the branch first.", "empty", s);
        return new GitHubError(`GitHub error ${s}${msg ? `: ${msg}` : ""}`, "other", s);
    }
    async getHead() {
        const ref = await this.request("GET", `/git/ref/heads/${encodePathSegments(this.cfg.branch)}`);
        const commit = await this.request("GET", `/git/commits/${ref.object.sha}`);
        return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
    }
    /** All files under `folder` (repo-root-relative paths -> blob sha). */
    async getFilesUnder(treeSha, folder) {
        const segs = folder.split("/").filter(Boolean);
        let sha = treeSha;
        for (const seg of segs) {
            const t = await this.request("GET", `/git/trees/${sha}`);
            const next = t.tree.find((e) => e.path === seg && e.type === "tree");
            if (!next)
                return {};
            sha = next.sha;
        }
        const t = await this.request("GET", `/git/trees/${sha}?recursive=1`);
        if (t.truncated)
            throw new GitHubError("The docs folder is too large to list from GitHub. Use a dedicated docs folder.", "other");
        const out = {};
        const prefix = segs.length ? segs.join("/") + "/" : "";
        for (const e of t.tree)
            if (e.type === "blob")
                out[prefix + e.path] = e.sha;
        return out;
    }
    async getBlobText(sha) {
        const b = await this.request("GET", `/git/blobs/${sha}`);
        if (b.encoding !== "base64")
            throw new GitHubError("Unexpected blob encoding from GitHub.", "other");
        return new TextDecoder().decode(decodeBase64(b.content));
    }
    async createBlob(bytes) {
        const r = await this.request("POST", "/git/blobs", { content: encodeBase64(bytes), encoding: "base64" });
        return r.sha;
    }
    async createTree(baseTree, entries) {
        const r = await this.request("POST", "/git/trees", { base_tree: baseTree, tree: entries });
        return r.sha;
    }
    async createCommit(message, tree, parent) {
        const r = await this.request("POST", "/git/commits", { message, tree, parents: [parent] });
        const { owner, repo } = this.cfg;
        return { sha: r.sha, url: r.html_url ?? `https://github.com/${owner}/${repo}/commit/${r.sha}` };
    }
    /** Fast-forward only (force: false). Throws BranchMovedError if the branch moved. */
    async updateRef(sha) {
        await this.request("PATCH", `/git/refs/heads/${encodePathSegments(this.cfg.branch)}`, { sha, force: false }, { raw422: true });
    }
}
function encodePathSegments(p) {
    return p.split("/").map(encodeURIComponent).join("/");
}
