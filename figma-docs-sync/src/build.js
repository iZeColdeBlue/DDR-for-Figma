import { extractDoc } from "./extract/extract";
import { renderDoc } from "./render/markdown";
import { gitBlobSha, utf8 } from "./sync/sha1";
import { joinPath } from "./paths";
export async function buildDoc(input) {
    const path = joinPath(input.docsFolder, input.relPath);
    const model = extractDoc(input.snapshot, { docId: input.docId, path, fileKey: input.fileKey });
    const warnings = [];
    // Export images first; drop blocks whose export fails (e.g. zero-size nodes) with a warning.
    const png = new Map();
    const kept = [];
    for (const b of model.blocks) {
        if (b.type !== "image") {
            kept.push(b);
            continue;
        }
        try {
            const bytes = await input.exportPng(b.nodeId);
            if (!bytes.length)
                throw new Error("empty export");
            png.set(b.nodeId, bytes);
            kept.push(b);
        }
        catch (e) {
            warnings.push(`Skipped image "${b.alt}": could not export (${e instanceof Error ? e.message : String(e)}).`);
        }
    }
    model.blocks = kept;
    const { markdown, assets } = renderDoc(model, { docsFolder: input.docsFolder, relPath: input.relPath });
    const files = [{ path, bytes: utf8(markdown), sha: "" }];
    for (const a of assets)
        files.push({ path: a.path, bytes: png.get(a.nodeId), sha: "" });
    for (const f of files)
        f.sha = gitBlobSha(f.bytes);
    return { docId: input.docId, title: model.title, relPath: input.relPath, path, nodeId: model.figma.nodeId, markdown, model, files, warnings };
}
