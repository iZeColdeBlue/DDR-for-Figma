// sync/sync: orchestrates fetch state -> diff -> one commit. No Figma dependency.
import type { Manifest } from "../types";
import { utf8 } from "./sha1";
import { computeDiff, type DesiredDoc, type DiffResult } from "./diff";
import { emptyManifest, manifestPath, parseManifest, serializeManifest } from "./manifest";
import { BranchMovedError, type GitHubClient, type TreeEntry } from "./github";

export type SyncDoc = DesiredDoc & { bytes: Record<string, Uint8Array> };

export type RemoteState = {
  commitSha: string;
  treeSha: string;
  remote: Record<string, string>;
  manifest: Manifest;
};

export async function loadRemoteState(client: GitHubClient, docsFolder: string): Promise<RemoteState> {
  const { commitSha, treeSha } = await client.getHead();
  const remote = await client.getFilesUnder(treeSha, docsFolder);
  const mPath = manifestPath(docsFolder);
  const mSha = remote[mPath];
  const manifest = mSha ? parseManifest(await client.getBlobText(mSha)) : emptyManifest();
  // The manifest is bookkeeping, not a generated doc file: keep it out of the conflict map.
  const files = { ...remote };
  delete files[mPath];
  return { commitSha, treeSha, remote: files, manifest };
}

export type DeleteMode = "ask" | "yes" | "no";

export type SyncOptions = {
  client: GitHubClient;
  docsFolder: string;
  docs: SyncDoc[];
  overwrite?: ReadonlySet<string>;
  deletes?: DeleteMode; // default "ask"
  onProgress?: (msg: string) => void;
  fileKey?: string;
  fileId?: string;
};

export type SyncOutcome =
  | { kind: "up-to-date"; diff: DiffResult }
  | { kind: "needs-confirmation"; diff: DiffResult }
  | { kind: "committed"; diff: DiffResult; commit: { sha: string; url: string }; message: string };

export function commitMessage(c: DiffResult["counts"]): string {
  return `docs: sync from Figma (${c.updated} updated, ${c.added} added, ${c.removed} removed)`;
}

export async function runSync(opts: SyncOptions): Promise<SyncOutcome> {
  try {
    return await syncOnce(opts);
  } catch (e) {
    if (!(e instanceof BranchMovedError)) throw e;
    opts.onProgress?.("Branch moved on GitHub – refetching and retrying once…");
    return await syncOnce(opts); // second BranchMovedError propagates to the caller
  }
}

async function syncOnce(opts: SyncOptions): Promise<SyncOutcome> {
  const { client, docsFolder, docs } = opts;
  const mode = opts.deletes ?? "ask";
  opts.onProgress?.("Reading repository state…");
  const state = await loadRemoteState(client, docsFolder);

  const diff = computeDiff({
    docs,
    manifest: state.manifest,
    remote: state.remote,
    overwrite: opts.overwrite,
    confirmDeletes: mode === "yes",
    fileKey: opts.fileKey,
    fileId: opts.fileId,
  });

  if (mode === "ask" && diff.pendingDeletes.length > 0) return { kind: "needs-confirmation", diff };
  if (!diff.changed) return { kind: "up-to-date", diff };

  const bytesByPath = new Map<string, Uint8Array>();
  for (const d of docs) for (const [p, b] of Object.entries(d.bytes)) bytesByPath.set(p, b);

  const entries: TreeEntry[] = [];
  let i = 0;
  for (const w of diff.writes) {
    opts.onProgress?.(`Uploading ${++i}/${diff.writes.length}: ${w.path}`);
    const bytes = bytesByPath.get(w.path);
    if (!bytes) throw new Error(`Internal error: no bytes for ${w.path}`);
    const sha = await client.createBlob(bytes);
    if (sha !== w.sha) throw new Error(`Hash mismatch for ${w.path} (local ${w.sha}, GitHub ${sha}).`);
    entries.push({ path: w.path, mode: "100644", type: "blob", sha });
  }
  for (const d of diff.deletes) entries.push({ path: d.path, mode: "100644", type: "blob", sha: null });

  const manifestText = serializeManifest(diff.manifest);
  const mBlob = await client.createBlob(utf8(manifestText));
  entries.push({ path: manifestPath(docsFolder), mode: "100644", type: "blob", sha: mBlob });

  opts.onProgress?.("Creating commit…");
  const tree = await client.createTree(state.treeSha, entries);
  const message = commitMessage(diff.counts);
  const commit = await client.createCommit(message, tree, state.commitSha);
  await client.updateRef(commit.sha);
  return { kind: "committed", diff, commit, message };
}
