// In-memory fake of the GitHub Git Data API endpoints the plugin uses. Blob SHAs are real git SHAs;
// tree/commit SHAs are synthetic. Enough fidelity to test one-commit sync, conflicts, retries, errors.
import { createHash } from "node:crypto";
import { gitBlobSha } from "../../src/sync/sha1";

type Flat = Map<string, string>; // path -> blob sha
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

export type FakeCommit = { sha: string; parent: string | null; tree: string; message: string };

export class FakeGitHub {
  token = "ghp_TESTTOKEN_not_real";
  owner = "acme";
  repo = "docs-repo";
  branch = "main";
  archived = false;
  blobs = new Map<string, Uint8Array>();
  trees = new Map<string, Flat>();
  commits = new Map<string, FakeCommit>();
  head = "";
  log: string[] = []; // "METHOD path"
  /** called right before a ref update; lets tests simulate someone pushing in between */
  beforeRefUpdate: (() => void) | null = null;
  /** queue of forced failures, consumed in order by matching requests */
  failures: { match: RegExp; status?: number; headers?: Record<string, string>; body?: unknown; network?: boolean; times: number }[] = [];
  requestBodies: string[] = [];
  requestHeaders: Record<string, string>[] = [];

  constructor(initial: Record<string, string> = { "README.md": "# repo\n" }) {
    const flat: Flat = new Map();
    for (const [p, c] of Object.entries(initial)) flat.set(p, this.putBlob(new TextEncoder().encode(c)));
    this.head = this.commitFlat(flat, null, "initial");
  }

  private putBlob(bytes: Uint8Array): string {
    const s = gitBlobSha(bytes);
    this.blobs.set(s, bytes);
    return s;
  }
  private registerTree(flat: Flat): string {
    const s = sha(JSON.stringify([...flat.entries()].sort()));
    this.trees.set(s, new Map(flat));
    return s;
  }
  private commitFlat(flat: Flat, parent: string | null, message: string): string {
    const tree = this.registerTree(flat);
    const s = sha(`${tree}|${parent}|${message}|${this.commits.size}`);
    this.commits.set(s, { sha: s, parent, tree, message });
    return s;
  }

  // ---- test helpers (act as "someone else on GitHub") ----
  files(commit = this.head): Record<string, string> {
    return Object.fromEntries(this.trees.get(this.commits.get(commit)!.tree)!);
  }
  text(path: string, commit = this.head): string {
    return new TextDecoder().decode(this.blobs.get(this.files(commit)[path])!);
  }
  commitCount(): number {
    let n = 0;
    for (let c: string | null = this.head; c; c = this.commits.get(c)!.parent) n++;
    return n;
  }
  /** direct push by another user (edit in the GitHub web UI) */
  userEdit(path: string, content: string | null, message = "manual edit"): void {
    const flat = new Map(this.trees.get(this.commits.get(this.head)!.tree)!);
    if (content === null) flat.delete(path);
    else flat.set(path, this.putBlob(new TextEncoder().encode(content)));
    this.head = this.commitFlat(flat, this.head, message);
  }
  changedPaths(commit = this.head): string[] {
    const c = this.commits.get(commit)!;
    const before = c.parent ? this.files(c.parent) : {};
    const after = this.files(commit);
    const out = new Set<string>();
    for (const k of Object.keys(after)) if (before[k] !== after[k]) out.add(k);
    for (const k of Object.keys(before)) if (!(k in after)) out.add(k);
    return [...out].sort();
  }

  // ---- fetch implementation ----
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const prefix = `/repos/${this.owner}/${this.repo}`;
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    this.log.push(`${method} ${path}${url.search}`);
    this.requestHeaders.push((init?.headers ?? {}) as Record<string, string>);
    this.requestBodies.push(typeof init?.body === "string" ? init.body : "");

    for (const f of this.failures) {
      if (f.times > 0 && f.match.test(`${method} ${path}`)) {
        f.times--;
        if (f.network) throw new TypeError("fetch failed");
        return json(f.body ?? { message: "forced" }, f.status ?? 500, f.headers);
      }
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== `Bearer ${this.token}`) return json({ message: "Bad credentials" }, 401);
    if (!url.pathname.startsWith(prefix)) return json({ message: "Not Found" }, 404);

    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    let m: RegExpMatchArray | null;

    if (method === "GET" && path === "") return json({ default_branch: "main", archived: this.archived });
    if (method === "POST" && path === "/git/refs") {
      // single-branch fake: creating a branch moves the one branch to the new name
      this.branch = String(body.ref).replace(/^refs\/heads\//, "");
      this.head = body.sha;
      return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    if (method === "GET" && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      if (decodeURIComponent(m[1]) !== this.branch) return json({ message: "Not Found" }, 404);
      return json({ object: { sha: this.head } });
    }
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]);
      return c ? json({ sha: c.sha, tree: { sha: c.tree } }) : json({ message: "Not Found" }, 404);
    }
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      const flat = this.trees.get(m[1]);
      if (!flat) return json({ message: "Not Found" }, 404);
      if (url.searchParams.get("recursive")) {
        return json({ sha: m[1], truncated: false, tree: [...flat.entries()].map(([p, s]) => ({ path: p, type: "blob", sha: s })) });
      }
      const direct = new Map<string, { type: string; sha: string }>();
      const dirs = new Map<string, Flat>();
      for (const [p, s] of flat) {
        const i = p.indexOf("/");
        if (i < 0) direct.set(p, { type: "blob", sha: s });
        else {
          const d = p.slice(0, i);
          if (!dirs.has(d)) dirs.set(d, new Map());
          dirs.get(d)!.set(p.slice(i + 1), s);
        }
      }
      for (const [d, sub] of dirs) direct.set(d, { type: "tree", sha: this.registerTree(sub) });
      return json({ sha: m[1], truncated: false, tree: [...direct.entries()].map(([p, v]) => ({ path: p, ...v })) });
    }
    if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const b = this.blobs.get(m[1]);
      return b ? json({ sha: m[1], encoding: "base64", content: Buffer.from(b).toString("base64").replace(/(.{60})/g, "$1\n") }) : json({ message: "Not Found" }, 404);
    }
    if (method === "POST" && path === "/git/blobs") {
      if (body.encoding !== "base64") return json({ message: "unsupported" }, 422);
      return json({ sha: this.putBlob(new Uint8Array(Buffer.from(body.content, "base64"))) }, 201);
    }
    if (method === "POST" && path === "/git/trees") {
      const base = this.trees.get(body.base_tree);
      if (!base) return json({ message: "base_tree not found" }, 422);
      const flat = new Map(base);
      for (const e of body.tree) {
        if (e.sha === null) flat.delete(e.path);
        else {
          if (!this.blobs.has(e.sha)) return json({ message: "blob not found" }, 422);
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
      if (!c || c.parent !== this.head) return json({ message: "Update is not a fast forward" }, 422);
      this.head = body.sha;
      return json({ ref: `refs/heads/${this.branch}`, object: { sha: this.head } });
    }
    return json({ message: `unhandled ${method} ${path}` }, 404);
  };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}
