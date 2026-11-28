// Simulated "Figma file + plugin pipeline" for end-to-end tests without Figma:
// fake node snapshots -> buildDoc (extract+render) -> runSync against FakeGitHub.
import { buildDoc, type BuiltDoc } from "../../src/build";
import type { NodeLike } from "../../src/extract/nodeLike";
import { GitHubClient } from "../../src/sync/github";
import { runSync, type DeleteMode, type SyncDoc } from "../../src/sync/sync";
import { FakeGitHub } from "./fakeGitHub";

export type WorldDoc = { docId: string; relPath: string; snapshot: NodeLike };

export class World {
  /** bump to simulate a visual change of a given node (changes its exported PNG bytes) */
  imageVersion = new Map<string, number>();
  constructor(public gh: FakeGitHub, public docs: WorldDoc[], public docsFolder = "docs") {}

  client(overrides: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}): GitHubClient {
    return new GitHubClient(
      { owner: this.gh.owner, repo: this.gh.repo, branch: this.gh.branch, token: this.gh.token, fetch: this.gh.fetch, ...overrides },
      async () => {},
    );
  }

  exportPng = async (nodeId: string): Promise<Uint8Array> => {
    const v = this.imageVersion.get(nodeId) ?? 0;
    return new TextEncoder().encode(`PNG[${nodeId}]v${v}`.padEnd(64, "."));
  };

  async build(): Promise<BuiltDoc[]> {
    return Promise.all(
      this.docs.map((d) =>
        buildDoc({ snapshot: d.snapshot, docId: d.docId, relPath: d.relPath, docsFolder: this.docsFolder, fileKey: "FILEKEY1234", exportPng: this.exportPng }),
      ),
    );
  }

  async sync(o: { deletes?: DeleteMode; overwrite?: string[]; client?: GitHubClient; onProgress?: (m: string) => void } = {}) {
    const built = await this.build();
    const docs: SyncDoc[] = built.map((b) => ({
      docId: b.docId,
      path: b.path,
      nodeId: b.nodeId,
      files: Object.fromEntries(b.files.map((f) => [f.path, f.sha])),
      bytes: Object.fromEntries(b.files.map((f) => [f.path, f.bytes])),
    }));
    return runSync({ client: o.client ?? this.client(), docsFolder: this.docsFolder, docs, overwrite: new Set(o.overwrite ?? []), deletes: o.deletes, onProgress: o.onProgress, fileKey: "FILEKEY1234" });
  }
}
