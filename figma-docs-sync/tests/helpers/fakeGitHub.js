// In-memory fake of the GitHub Git Data API endpoints the plugin uses. Blob SHAs are real git SHAs;
// tree/commit SHAs are synthetic. Enough fidelity to test one-commit sync, conflicts, retries, errors.
import { createHash } from "node:crypto";
import { gitBlobSha } from "../../src/sync/sha1";
const sha = (s) => createHash("sha1").update(s).digest("hex");
export class FakeGitHub {
    constructor(initial = { "README.md": "# repo\n" }) {
        this.token = "ghp_TESTTOKEN_not_real";
        this.owner = "acme";
        this.repo = "docs-repo";
        this.branch = "main";
        this.blobs = new Map();
        this.trees = new Map();
        this.commits = new Map();
        this.head = "";
        this.log = []; // "METHOD path"
        /** called right before a ref update; lets tests simulate someone pushing in between */
        this.beforeRefUpdate = null;
        /** queue of forced failures, consumed in order by matching requests */
        this.failures = [];
        this.requestBodies = [];
        this.requestHeaders = [];
        // ---- fetch implementation ----
        this.fetch = async (input, init) => {
            const url = new URL(String(input));
            const method = (init?.method ?? "GET").toUpperCase();
            const prefix = `/repos/${this.owner}/${this.repo}`;
            const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
            this.log.push(`${method} ${path}${url.search}`);
            this.requestHeaders.push((init?.headers ?? {}));
            this.requestBodies.push(typeof init?.body === "string" ? init.body : "");
            for (const f of this.failures) {
                if (f.times > 0 && f.match.test(`${method} ${path}`)) {
                    f.times--;
                    if (f.network)
                        throw new TypeError("fetch failed");
                    return json(f.body ?? { message: "forced" }, f.status ?? 500, f.headers);
                }
            }
            const auth = init?.headers?.Authorization;
            if (auth !== `Bearer ${this.token}`)
                return json({ message: "Bad credentials" }, 401);
            if (!url.pathname.startsWith(prefix))
                return json({ message: "Not Found" }, 404);
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            let m;
            if (method === "GET" && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
                if (decodeURIComponent(m[1]) !== this.branch)
                    return json({ message: "Not Found" }, 404);
                return json({ object: { sha: this.head } });
            }
            if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
                const c = this.commits.get(m[1]);
                return c ? json({ sha: c.sha, tree: { sha: c.tree } }) : json({ message: "Not Found" }, 404);
            }
            if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
                const flat = this.trees.get(m[1]);
                if (!flat)
                    return json({ message: "Not Found" }, 404);
                if (url.searchParams.get("recursive")) {
                    return json({ sha: m[1], truncated: false, tree: [...flat.entries()].map(([p, s]) => ({ path: p, type: "blob", sha: s })) });
                }
                const direct = new Map();
                const dirs = new Map();
                for (const [p, s] of flat) {
                    const i = p.indexOf("/");
                    if (i < 0)
                        direct.set(p, { type: "blob", sha: s });
                    else {
                        const d = p.slice(0, i);
                        if (!dirs.has(d))
                            dirs.set(d, new Map());
                        dirs.get(d).set(p.slice(i + 1), s);
                    }
                }
                for (const [d, sub] of dirs)
                    direct.set(d, { type: "tree", sha: this.registerTree(sub) });
                return json({ sha: m[1], truncated: false, tree: [...direct.entries()].map(([p, v]) => ({ path: p, ...v })) });
            }
            if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
                const b = this.blobs.get(m[1]);
                return b ? json({ sha: m[1], encoding: "base64", content: Buffer.from(b).toString("base64").replace(/(.{60})/g, "$1\n") }) : json({ message: "Not Found" }, 404);
            }
            if (method === "POST" && path === "/git/blobs") {
                if (body.encoding !== "base64")
                    return json({ message: "unsupported" }, 422);
                return json({ sha: this.putBlob(new Uint8Array(Buffer.from(body.content, "base64"))) }, 201);
            }
            if (method === "POST" && path === "/git/trees") {
                const base = this.trees.get(body.base_tree);
                if (!base)
                    return json({ message: "base_tree not found" }, 422);
                const flat = new Map(base);
                for (const e of body.tree) {
                    if (e.sha === null)
                        flat.delete(e.path);
                    else {
                        if (!this.blobs.has(e.sha))
                            return json({ message: "blob not found" }, 422);
                        flat.set(e.path, e.sha);
                    }
                }
                return json({ sha: this.registerTree(flat) }, 201);
            }
            if (method === "POST" && path === "/git/commits") {
                const s = sha(`${body.tree}|${body.parents[0]}|${body.message}|${this.commits.size}`);
                this.commits.set(s, { sha: s, parent: body.parents[0], tree: body.tree, message: body.message });
                return json({ sha: s, html_url: `https://github.com/${this.owner}/${this.repo}/commit/${s}` }, 201);
            }
            if (method === "PATCH" && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
                this.beforeRefUpdate?.();
                const c = this.commits.get(body.sha);
                if (!c || c.parent !== this.head)
                    return json({ message: "Update is not a fast forward" }, 422);
                this.head = body.sha;
                return json({ ref: `refs/heads/${this.branch}`, object: { sha: this.head } });
            }
            return json({ message: `unhandled ${method} ${path}` }, 404);
        };
        const flat = new Map();
        for (const [p, c] of Object.entries(initial))
            flat.set(p, this.putBlob(new TextEncoder().encode(c)));
        this.head = this.commitFlat(flat, null, "initial");
    }
    putBlob(bytes) {
        const s = gitBlobSha(bytes);
        this.blobs.set(s, bytes);
        return s;
    }
    registerTree(flat) {
        const s = sha(JSON.stringify([...flat.entries()].sort()));
        this.trees.set(s, new Map(flat));
        return s;
    }
    commitFlat(flat, parent, message) {
        const tree = this.registerTree(flat);
        const s = sha(`${tree}|${parent}|${message}|${this.commits.size}`);
        this.commits.set(s, { sha: s, parent, tree, message });
        return s;
    }
    // ---- test helpers (act as "someone else on GitHub") ----
    files(commit = this.head) {
        return Object.fromEntries(this.trees.get(this.commits.get(commit).tree));
    }
    text(path, commit = this.head) {
        return new TextDecoder().decode(this.blobs.get(this.files(commit)[path]));
    }
    commitCount() {
        let n = 0;
        for (let c = this.head; c; c = this.commits.get(c).parent)
            n++;
        return n;
    }
    /** direct push by another user (edit in the GitHub web UI) */
    userEdit(path, content, message = "manual edit") {
        const flat = new Map(this.trees.get(this.commits.get(this.head).tree));
        if (content === null)
            flat.delete(path);
        else
            flat.set(path, this.putBlob(new TextEncoder().encode(content)));
        this.head = this.commitFlat(flat, this.head, message);
    }
    changedPaths(commit = this.head) {
        const c = this.commits.get(commit);
        const before = c.parent ? this.files(c.parent) : {};
        const after = this.files(commit);
        const out = new Set();
        for (const k of Object.keys(after))
            if (before[k] !== after[k])
                out.add(k);
        for (const k of Object.keys(before))
            if (!(k in after))
                out.add(k);
        return [...out].sort();
    }
}
function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}
