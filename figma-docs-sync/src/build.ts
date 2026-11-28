// build: snapshot -> DocModel -> assets exported -> Markdown -> files with git SHAs.
// Glue between the layers; pure apart from the injected `exportPng` callback.
import type { DocModel, OutFile } from "./types";
import { extractDoc } from "./extract/extract";
import type { NodeLike } from "./extract/nodeLike";
import { renderDoc } from "./render/markdown";
import { gitBlobSha, utf8 } from "./sync/sha1";
import { joinPath } from "./paths";

export type BuildInput = {
  snapshot: NodeLike;
  docId: string;
  /** path relative to the docs folder, e.g. "buttons.md" */
  relPath: string;
  docsFolder: string;
  fileKey?: string;
  exportPng: (nodeId: string) => Promise<Uint8Array>;
};

export type BuiltDoc = {
  docId: string;
  title: string;
  relPath: string;
  path: string;
  nodeId: string;
  markdown: string;
  model: DocModel;
  files: OutFile[];
  warnings: string[];
};

export async function buildDoc(input: BuildInput): Promise<BuiltDoc> {
  const path = joinPath(input.docsFolder, input.relPath);
  const model = extractDoc(input.snapshot, { docId: input.docId, path, fileKey: input.fileKey });
  const warnings: string[] = [];

  // Export images first; drop blocks whose export fails (e.g. zero-size nodes) with a warning.
  const png = new Map<string, Uint8Array>();
  const kept = [];
  for (const b of model.blocks) {
    if (b.type !== "image") {
      kept.push(b);
      continue;
    }
    try {
      const bytes = await input.exportPng(b.nodeId);
      if (!bytes.length) throw new Error("empty export");
      png.set(b.nodeId, bytes);
      kept.push(b);
    } catch (e) {
      warnings.push(`Skipped image "${b.alt}": could not export (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  model.blocks = kept;

  const { markdown, assets } = renderDoc(model, { docsFolder: input.docsFolder, relPath: input.relPath });
  const files: OutFile[] = [{ path, bytes: utf8(markdown), sha: "" }];
  for (const a of assets) files.push({ path: a.path, bytes: png.get(a.nodeId) as Uint8Array, sha: "" });
  for (const f of files) f.sha = gitBlobSha(f.bytes);

  return { docId: input.docId, title: model.title, relPath: input.relPath, path, nodeId: model.figma.nodeId, markdown, model, files, warnings };
}
