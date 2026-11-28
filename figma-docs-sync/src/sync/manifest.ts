import { MANIFEST_NAME, type Manifest } from "../types";
import { joinPath } from "../paths";

export const emptyManifest = (): Manifest => ({ version: 1, docs: {} });

export const manifestPath = (docsFolder: string): string => joinPath(docsFolder, MANIFEST_NAME);

/** Deterministic serialisation (sorted keys) so an unchanged manifest is byte-identical. */
export function serializeManifest(m: Manifest): string {
  const docs: Manifest["docs"] = {};
  for (const id of Object.keys(m.docs).sort()) {
    const d = m.docs[id];
    const files: Record<string, string> = {};
    for (const p of Object.keys(d.files).sort()) files[p] = d.files[p];
    docs[id] = { path: d.path, nodeId: d.nodeId, files };
  }
  return JSON.stringify({ version: 1, docs }, null, 2) + "\n";
}

/** Parse a manifest; throws a readable error for anything that is not a v1 manifest. */
export function parseManifest(text: string): Manifest {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${MANIFEST_NAME} in the repo is not valid JSON. Fix or delete it in GitHub, then sync again.`);
  }
  if (!raw || raw.version !== 1 || typeof raw.docs !== "object" || raw.docs === null)
    throw new Error(`${MANIFEST_NAME} has an unsupported format (expected version 1).`);
  for (const [id, d] of Object.entries<any>(raw.docs)) {
    if (!d || typeof d.path !== "string" || typeof d.files !== "object" || d.files === null)
      throw new Error(`${MANIFEST_NAME}: entry "${id}" is malformed.`);
  }
  return raw as Manifest;
}
