// sync/diff: pure computation of what a sync would do (blueprint §7). No Figma, no network.
import type { Manifest, ManifestDoc } from "../types";
import { serializeManifest } from "./manifest";

export type DocStatus = "new" | "changed" | "up to date" | "conflict";

/** A Doc as it would be written now. `files` maps repo path -> git blob sha. */
export type DesiredDoc = {
  docId: string;
  path: string;
  nodeId: string;
  files: Record<string, string>;
};

export type DiffInput = {
  docs: DesiredDoc[];
  manifest: Manifest;
  /** Current repo state: path -> git blob sha, for every existing file under the docs folder. */
  remote: Record<string, string>;
  /** docIds the user explicitly chose to overwrite/delete despite conflicts. */
  overwrite?: ReadonlySet<string>;
  /** If false, deletions are only reported (pending), not performed. */
  confirmDeletes?: boolean;
  /** Current Figma file. Missing Docs owned by another file are left alone. */
  fileKey?: string;
  /** Stable per-file id; decides ownership. Unowned legacy entries are then never treated as ours. */
  fileId?: string;
};

export type DocDiff = {
  docId: string;
  status: DocStatus;
  added: string[];
  updated: string[];
  removed: string[]; // files that will be (or, if unconfirmed, would be) deleted
  conflicts: string[];
};

export type OrphanDiff = {
  docId: string;
  path: string;
  removed: string[];
  conflicts: string[];
};

export type Write = { path: string; docId: string; sha: string; kind: "add" | "update" };
export type Delete = { path: string; docId: string };

export type DiffResult = {
  docs: DocDiff[];
  orphans: OrphanDiff[];
  writes: Write[];
  /** deletions that will be performed */
  deletes: Delete[];
  /** deletions that need user confirmation first (only when confirmDeletes is false) */
  pendingDeletes: Delete[];
  manifest: Manifest; // what to write if committing
  /** true if a commit is needed (file changes or manifest change) */
  changed: boolean;
  counts: { updated: number; added: number; removed: number };
};

export function findPathCollisions(docs: DesiredDoc[]): string[] {
  const owner = new Map<string, string>();
  const errors: string[] = [];
  for (const d of docs) {
    for (const p of Object.keys(d.files)) {
      const prev = owner.get(p);
      if (prev && prev !== d.docId) errors.push(`${p} is produced by more than one Doc.`);
      owner.set(p, d.docId);
    }
  }
  return errors;
}

export function computeDiff(input: DiffInput): DiffResult {
  const { docs, manifest, remote } = input;
  const overwrite = input.overwrite ?? new Set<string>();
  const confirm = input.confirmDeletes ?? false;

  const collisions = findPathCollisions(docs);
  if (collisions.length) throw new Error(collisions.join(" "));

  const writes: Write[] = [];
  const deletes: Delete[] = [];
  const pendingDeletes: Delete[] = [];
  const nextDocs: Manifest["docs"] = {};
  const docDiffs: DocDiff[] = [];
  const orphans: OrphanDiff[] = [];
  const desiredIds = new Set(docs.map((d) => d.docId));
  // A path another Doc now writes is handed over, never deleted (else one commit writes and deletes it).
  const claimed = new Set(docs.flatMap((d) => Object.keys(d.files)));

  // ---- Docs that exist in Figma ----
  for (const d of docs) {
    const old: ManifestDoc | undefined = manifest.docs[d.docId];
    const oldFiles = old?.files ?? {};
    const force = overwrite.has(d.docId);

    const added: string[] = [];
    const updated: string[] = [];
    const conflicts: string[] = [];
    const removedNow: string[] = []; // deletable
    const nextFiles: Record<string, string> = {};
    const docWrites: Write[] = [];

    for (const [p, sha] of Object.entries(d.files)) {
      const r = remote[p];
      const tracked = p in oldFiles;
      const m = oldFiles[p];
      nextFiles[p] = sha;
      if (r === undefined) {
        docWrites.push({ path: p, docId: d.docId, sha, kind: "add" });
        added.push(p);
      } else if (r === sha) {
        // already in place (unchanged, or someone made the identical edit): adopt, no write
      } else if (tracked && r === m) {
        docWrites.push({ path: p, docId: d.docId, sha, kind: "update" });
        updated.push(p);
      } else {
        // Remote differs from what we last wrote (or from an untracked pre-existing file): never clobber silently.
        if (force) {
          docWrites.push({ path: p, docId: d.docId, sha, kind: "update" });
          updated.push(p);
        } else {
          conflicts.push(p);
        }
      }
    }

    for (const [p, m] of Object.entries(oldFiles)) {
      if (claimed.has(p)) continue;
      const r = remote[p];
      if (r === undefined) continue; // already gone; just forget it
      if (r === m || force) removedNow.push(p);
      else {
        conflicts.push(p); // generated file edited in Git: keep it
        nextFiles[p] = m;
      }
    }

    if (conflicts.length) {
      // Conflict: skip the whole doc, keep its manifest entry untouched.
      if (old) nextDocs[d.docId] = old;
      docDiffs.push({ docId: d.docId, status: "conflict", added: [], updated: [], removed: [], conflicts });
      continue;
    }

    for (const p of removedNow) {
      if (confirm) deletes.push({ path: p, docId: d.docId });
      else {
        pendingDeletes.push({ path: p, docId: d.docId });
        nextFiles[p] = oldFiles[p]; // still tracked until deleted
      }
    }
    writes.push(...docWrites);

    const entry: ManifestDoc = { path: d.path, nodeId: d.nodeId, fileKey: input.fileKey ?? old?.fileKey, fileId: input.fileId ?? old?.fileId, files: nextFiles };
    const filesChanged = !sameFiles(oldFiles, nextFiles) || (old && old.path !== d.path);
    entry.nodeId = old && !filesChanged && docWrites.length === 0 ? old.nodeId : d.nodeId;
    nextDocs[d.docId] = entry;

    let status: DocStatus;
    if (!old) status = "new";
    else if (docWrites.length || removedNow.length || filesChanged) status = "changed";
    else status = "up to date";
    docDiffs.push({ docId: d.docId, status, added, updated, removed: removedNow, conflicts: [] });
  }

  // ---- Docs in the manifest whose frame no longer exists ----
  for (const [docId, old] of Object.entries(manifest.docs)) {
    if (desiredIds.has(docId)) continue;
    const mine = old.fileId ? old.fileId === input.fileId : old.fileKey ? old.fileKey === input.fileKey : !input.fileId;
    if (!mine) {
      nextDocs[docId] = old; // another Figma file's Doc (or owner unknown): not ours to show or delete
      continue;
    }
    const force = overwrite.has(docId);
    const removed: string[] = [];
    const conflicts: string[] = [];
    const keep: Record<string, string> = {};
    for (const [p, m] of Object.entries(old.files)) {
      const r = remote[p];
      if (r === undefined || claimed.has(p)) continue;
      if (r === m || force) {
        removed.push(p);
        if (confirm) deletes.push({ path: p, docId });
        else {
          pendingDeletes.push({ path: p, docId });
          keep[p] = m;
        }
      } else {
        conflicts.push(p);
        keep[p] = m;
      }
    }
    orphans.push({ docId, path: old.path, removed, conflicts });
    if (Object.keys(keep).length) nextDocs[docId] = { ...old, files: keep };
  }

  const next: Manifest = { version: 1, docs: nextDocs };
  const changed =
    writes.length > 0 || deletes.length > 0 || serializeManifest(next) !== serializeManifest(manifest);

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

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}
