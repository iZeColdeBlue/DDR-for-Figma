import { MANIFEST_NAME } from "../types";
import { utf8 } from "./sha1";
import { computeDiff } from "./diff";
import { emptyManifest, manifestPath, parseManifest, serializeManifest } from "./manifest";
import { BranchMovedError } from "./github";
export async function loadRemoteState(client, docsFolder) {
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
export function commitMessage(c) {
    return `docs: sync from Figma (${c.updated} updated, ${c.added} added, ${c.removed} removed)`;
}
export async function runSync(opts) {
    try {
        return await syncOnce(opts);
    }
    catch (e) {
        if (!(e instanceof BranchMovedError))
            throw e;
        opts.onProgress?.("Branch moved on GitHub – refetching and retrying once…");
        return await syncOnce(opts); // second BranchMovedError propagates to the caller
    }
}
async function syncOnce(opts) {
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
    });
    if (mode === "ask" && diff.pendingDeletes.length > 0)
        return { kind: "needs-confirmation", diff };
    if (!diff.changed)
        return { kind: "up-to-date", diff };
    const bytesByPath = new Map();
    for (const d of docs)
        for (const [p, b] of Object.entries(d.bytes))
            bytesByPath.set(p, b);
    const entries = [];
    let i = 0;
    for (const w of diff.writes) {
        opts.onProgress?.(`Uploading ${++i}/${diff.writes.length}: ${w.path}`);
        const bytes = bytesByPath.get(w.path);
        if (!bytes)
            throw new Error(`Internal error: no bytes for ${w.path}`);
        const sha = await client.createBlob(bytes);
        if (sha !== w.sha)
            throw new Error(`Hash mismatch for ${w.path} (local ${w.sha}, GitHub ${sha}).`);
        entries.push({ path: w.path, mode: "100644", type: "blob", sha });
    }
    for (const d of diff.deletes)
        entries.push({ path: d.path, mode: "100644", type: "blob", sha: null });
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
export { MANIFEST_NAME };
