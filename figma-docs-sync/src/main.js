// Plugin main thread: orchestration only. All Figma access goes through `host` (src/extract/figmaHost.ts).
import { host } from "./extract/figmaHost";
import { buildDoc } from "./build";
import { parseFileKey } from "./fileKey";
import { normalizeFolder } from "./paths";
host.showUI(__html__);
let docs = [];
let busy = false;
async function refreshDocs() {
    docs = await host.listDocs();
    host.post({ type: "docs", docs, fileKey: host.fileKey() });
}
function postSelection() {
    host.post({ type: "selection", selection: host.selection() });
}
host.onSelectionChange(postSelection);
async function resolveFileKey(figmaFileUrl) {
    return host.fileKey() ?? (figmaFileUrl ? parseFileKey(figmaFileUrl) : undefined);
}
async function buildAll() {
    const settings = await host.loadSettings();
    const docsFolder = normalizeFolder(settings.docsFolder);
    const fileKey = await resolveFileKey(settings.figmaFileUrl);
    await refreshDocs();
    const out = [];
    const active = docs.filter((d) => !d.duplicate);
    let i = 0;
    for (const d of active) {
        host.post({ type: "progress", text: `Converting ${++i}/${active.length}: ${d.name}` });
        const snapshot = await host.snapshot(d.nodeId);
        const built = await buildDoc({
            snapshot,
            docId: d.docId,
            relPath: d.relPath,
            docsFolder,
            fileKey,
            exportPng: (id) => host.exportPng(id),
        });
        out.push({
            docId: built.docId,
            title: built.title,
            relPath: built.relPath,
            path: built.path,
            nodeId: built.nodeId,
            markdown: built.markdown,
            files: built.files,
            warnings: built.warnings,
        });
    }
    return out;
}
async function handle(m) {
    switch (m.type) {
        case "init": {
            host.post({ type: "settings", settings: await host.loadSettings() });
            await refreshDocs();
            postSelection();
            return;
        }
        case "saveSettings":
            await host.saveSettings(m.settings);
            host.post({ type: "settings", settings: m.settings });
            return;
        case "listDocs":
            await refreshDocs();
            postSelection();
            return;
        case "mark": {
            await refreshDocs();
            await host.markSelection(docs.map((d) => d.relPath));
            await refreshDocs();
            postSelection();
            return;
        }
        case "setPath":
            await host.setRelPath(m.docId, m.relPath, docs.filter((d) => d.docId !== m.docId).map((d) => d.relPath));
            await refreshDocs();
            return;
        case "reId": {
            const d = docs.find((x) => x.docId === m.docId && x.duplicate);
            if (!d)
                throw new Error("That frame is no longer a duplicate.");
            await host.reId(d.nodeId, docs.map((x) => x.relPath));
            await refreshDocs();
            return;
        }
        case "focus":
            await host.focus(m.docId);
            return;
        case "build": {
            host.post({ type: "built", docs: await buildAll() });
            return;
        }
    }
}
host.onMessage((m) => {
    if (busy && m.type === "build") {
        host.post({ type: "error", message: "A conversion is already running." });
        return;
    }
    const isBuild = m.type === "build";
    if (isBuild)
        busy = true;
    handle(m)
        .catch((e) => host.post({ type: "error", message: e instanceof Error ? e.message : String(e) }))
        .finally(() => {
        if (isBuild)
            busy = false;
    });
});
