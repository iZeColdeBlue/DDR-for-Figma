// Simulated "Figma file + plugin pipeline" for end-to-end tests without Figma:
// fake node snapshots -> buildDoc (extract+render) -> runSync against FakeGitHub.
import { buildDoc } from "../../src/build";
import { GitHubClient } from "../../src/sync/github";
import { runSync } from "../../src/sync/sync";
export class World {
    constructor(gh, docs, docsFolder = "docs") {
        this.gh = gh;
        this.docs = docs;
        this.docsFolder = docsFolder;
        /** bump to simulate a visual change of a given node (changes its exported PNG bytes) */
        this.imageVersion = new Map();
        this.exportPng = async (nodeId) => {
            const v = this.imageVersion.get(nodeId) ?? 0;
            return new TextEncoder().encode(`PNG[${nodeId}]v${v}`.padEnd(64, "."));
        };
    }
    client(overrides = {}) {
        return new GitHubClient({ owner: this.gh.owner, repo: this.gh.repo, branch: this.gh.branch, token: this.gh.token, fetch: this.gh.fetch, ...overrides }, async () => { });
    }
    async build() {
        return Promise.all(this.docs.map((d) => buildDoc({ snapshot: d.snapshot, docId: d.docId, relPath: d.relPath, docsFolder: this.docsFolder, fileKey: "FILEKEY1234", exportPng: this.exportPng })));
    }
    async sync(o = {}) {
        const built = await this.build();
        const docs = built.map((b) => ({
            docId: b.docId,
            path: b.path,
            nodeId: b.nodeId,
            files: Object.fromEntries(b.files.map((f) => [f.path, f.sha])),
            bytes: Object.fromEntries(b.files.map((f) => [f.path, f.bytes])),
        }));
        return runSync({ client: o.client ?? this.client(), docsFolder: this.docsFolder, docs, overwrite: new Set(o.overwrite ?? []), deletes: o.deletes, onProgress: o.onProgress });
    }
}
