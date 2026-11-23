import { serializeManifest } from "./manifest";
export function findPathCollisions(docs) {
    const owner = new Map();
    const errors = [];
    for (const d of docs) {
        for (const p of Object.keys(d.files)) {
            const prev = owner.get(p);
            if (prev && prev !== d.docId)
                errors.push(`${p} is produced by more than one Doc.`);
            owner.set(p, d.docId);
        }
    }
    return errors;
}
export function computeDiff(input) {
    const { docs, manifest, remote } = input;
    const overwrite = input.overwrite ?? new Set();
    const confirm = input.confirmDeletes ?? false;
    const collisions = findPathCollisions(docs);
    if (collisions.length)
        throw new Error(collisions.join(" "));
    const writes = [];
    const deletes = [];
    const pendingDeletes = [];
    const nextDocs = {};
    const docDiffs = [];
    const orphans = [];
    const desiredIds = new Set(docs.map((d) => d.docId));
    // ---- Docs that exist in Figma ----
    for (const d of docs) {
        const old = manifest.docs[d.docId];
        const oldFiles = old?.files ?? {};
        const force = overwrite.has(d.docId);
        const added = [];
        const updated = [];
        const conflicts = [];
        const removedNow = []; // deletable
        const nextFiles = {};
        const docWrites = [];
        for (const [p, sha] of Object.entries(d.files)) {
            const r = remote[p];
            const tracked = p in oldFiles;
            const m = oldFiles[p];
            nextFiles[p] = sha;
            if (r === undefined) {
                docWrites.push({ path: p, docId: d.docId, sha, kind: "add" });
                added.push(p);
            }
            else if (r === sha) {
                // already in place (unchanged, or someone made the identical edit): adopt, no write
            }
            else if (tracked && r === m) {
                docWrites.push({ path: p, docId: d.docId, sha, kind: "update" });
                updated.push(p);
            }
            else {
                // Remote differs from what we last wrote (or from an untracked pre-existing file): never clobber silently.
                if (force) {
                    docWrites.push({ path: p, docId: d.docId, sha, kind: "update" });
                    updated.push(p);
                }
                else {
                    conflicts.push(p);
                }
            }
        }
        for (const [p, m] of Object.entries(oldFiles)) {
            if (p in d.files)
                continue;
            const r = remote[p];
            if (r === undefined)
                continue; // already gone; just forget it
            if (r === m || force)
                removedNow.push(p);
            else {
                conflicts.push(p); // generated file edited in Git: keep it
                nextFiles[p] = m;
            }
        }
        if (conflicts.length) {
            // Conflict: skip the whole doc, keep its manifest entry untouched.
            if (old)
                nextDocs[d.docId] = old;
            docDiffs.push({ docId: d.docId, status: "conflict", added: [], updated: [], removed: [], conflicts });
            continue;
        }
        for (const p of removedNow) {
            if (confirm)
                deletes.push({ path: p, docId: d.docId });
            else {
                pendingDeletes.push({ path: p, docId: d.docId });
                nextFiles[p] = oldFiles[p]; // still tracked until deleted
            }
        }
        writes.push(...docWrites);
        const entry = { path: d.path, nodeId: d.nodeId, files: nextFiles };
        const filesChanged = !sameFiles(oldFiles, nextFiles) || (old && old.path !== d.path);
        entry.nodeId = old && !filesChanged && docWrites.length === 0 ? old.nodeId : d.nodeId;
        nextDocs[d.docId] = entry;
        let status;
        if (!old)
            status = "new";
        else if (docWrites.length || removedNow.length || filesChanged)
            status = "changed";
        else
            status = "up to date";
        docDiffs.push({ docId: d.docId, status, added, updated, removed: removedNow, conflicts: [] });
    }
    // ---- Docs in the manifest whose frame no longer exists ----
    for (const [docId, old] of Object.entries(manifest.docs)) {
        if (desiredIds.has(docId))
            continue;
        const force = overwrite.has(docId);
        const removed = [];
        const conflicts = [];
        const keep = {};
        for (const [p, m] of Object.entries(old.files)) {
            const r = remote[p];
            if (r === undefined)
                continue;
            if (r === m || force) {
                removed.push(p);
                if (confirm)
                    deletes.push({ path: p, docId });
                else {
                    pendingDeletes.push({ path: p, docId });
                    keep[p] = m;
                }
            }
            else {
                conflicts.push(p);
                keep[p] = m;
            }
        }
        orphans.push({ docId, path: old.path, removed, conflicts });
        if (Object.keys(keep).length)
            nextDocs[docId] = { ...old, files: keep };
    }
    const next = { version: 1, docs: nextDocs };
    const changed = writes.length > 0 || deletes.length > 0 || serializeManifest(next) !== serializeManifest(manifest);
    return {
        docs: docDiffs,
        orphans,
        writes,
        deletes,
        pendingDeletes,
        manifest: next,
        changed,
        counts: {
            updated: writes.filter((w) => w.kind === "update").length,
            added: writes.filter((w) => w.kind === "add").length,
            removed: deletes.length,
        },
    };
}
function sameFiles(a, b) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length)
        return false;
    return ka.every((k) => a[k] === b[k]);
}
