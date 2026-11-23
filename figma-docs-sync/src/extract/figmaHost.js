import { DEFAULT_SETTINGS } from "../messages";
import { slugify, uniqueRelPath, normalizeRelPath } from "../paths";
import { uuid } from "../uuid";
const PD = { docId: "fds.docId", relPath: "fds.relPath", nodeId: "fds.nodeId" };
const SETTINGS_KEY = "fds.settings";
const DOC_TYPES = ["FRAME", "SECTION", "COMPONENT"];
const isDocType = (t) => DOC_TYPES.includes(t);
export const host = {
    showUI(html) {
        figma.showUI(html, { width: 420, height: 640, themeColors: true });
    },
    onMessage(handler) {
        figma.ui.onmessage = (m) => handler(m);
    },
    post(m) {
        figma.ui.postMessage(m);
    },
    onSelectionChange(cb) {
        figma.on("selectionchange", cb);
    },
    // ----- settings (token lives here only) -----
    async loadSettings() {
        const saved = (await figma.clientStorage.getAsync(SETTINGS_KEY));
        return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    },
    async saveSettings(s) {
        await figma.clientStorage.setAsync(SETTINGS_KEY, s);
    },
    fileKey() {
        return figma.fileKey ?? undefined;
    },
    // ----- docs -----
    async listDocs() {
        await figma.loadAllPagesAsync();
        const nodes = figma.root.findAllWithCriteria({ types: [...DOC_TYPES], pluginData: { keys: [PD.docId] } });
        const byId = new Map();
        for (const n of nodes) {
            const id = n.getPluginData(PD.docId);
            if (!id)
                continue;
            byId.set(id, [...(byId.get(id) ?? []), n]);
        }
        const out = [];
        for (const [docId, group] of byId) {
            const originals = group.filter((n) => n.getPluginData(PD.nodeId) === n.id);
            const keep = group.length === 1 ? group[0] : originals.length === 1 ? originals[0] : group[0];
            for (const n of group) {
                const duplicate = group.length > 1 && n !== keep;
                if (!duplicate && n.getPluginData(PD.nodeId) !== n.id)
                    n.setPluginData(PD.nodeId, n.id);
                let relPath = n.getPluginData(PD.relPath);
                if (!relPath) {
                    relPath = uniqueRelPath(slugify(n.name) + ".md", out.map((o) => o.relPath));
                    n.setPluginData(PD.relPath, relPath);
                }
                out.push({ docId, nodeId: n.id, name: n.name, page: pageOf(n), relPath, duplicate });
            }
        }
        return out;
    },
    selection() {
        const sel = figma.currentPage.selection;
        if (sel.length !== 1)
            return null;
        const n = sel[0];
        const docId = "getPluginData" in n ? n.getPluginData(PD.docId) : "";
        return {
            nodeId: n.id,
            name: n.name,
            type: n.type,
            markable: isDocType(n.type) && !docId,
            docId: docId || undefined,
        };
    },
    async markSelection(takenRelPaths) {
        const sel = figma.currentPage.selection;
        if (sel.length !== 1)
            throw new Error("Select exactly one frame first.");
        const n = sel[0];
        if (!isDocType(n.type))
            throw new Error("Select a frame (or section / component) to mark as a Doc.");
        if (n.getPluginData(PD.docId))
            throw new Error("This frame is already a Doc.");
        const docId = uuid();
        const relPath = uniqueRelPath(slugify(n.name) + ".md", takenRelPaths);
        n.setPluginData(PD.docId, docId);
        n.setPluginData(PD.relPath, relPath);
        n.setPluginData(PD.nodeId, n.id);
        return { docId, relPath };
    },
    async setRelPath(docId, relPath, takenByOthers) {
        const norm = normalizeRelPath(relPath);
        if (!norm.ok)
            throw new Error(norm.error);
        if (takenByOthers.some((p) => p.toLowerCase() === norm.path.toLowerCase()))
            throw new Error(`Another Doc already uses ${norm.path}.`);
        const n = findDocNode(docId);
        n.setPluginData(PD.relPath, norm.path);
        return norm.path;
    },
    async reId(nodeId, takenRelPaths) {
        const n = (await figma.getNodeByIdAsync(nodeId));
        if (!n || !("setPluginData" in n))
            throw new Error("Frame not found.");
        n.setPluginData(PD.docId, uuid());
        n.setPluginData(PD.relPath, uniqueRelPath(slugify(n.name) + ".md", takenRelPaths));
        n.setPluginData(PD.nodeId, n.id);
    },
    async focus(docId) {
        const n = findDocNode(docId);
        await figma.setCurrentPageAsync(pageNodeOf(n));
        figma.currentPage.selection = [n];
        figma.viewport.scrollAndZoomIntoView([n]);
    },
    async snapshot(nodeId) {
        const n = (await figma.getNodeByIdAsync(nodeId));
        if (!n)
            throw new Error("Frame not found (was it deleted?).");
        return snapshotNode(n, true, new Map());
    },
    async exportPng(nodeId) {
        const n = (await figma.getNodeByIdAsync(nodeId));
        if (!n || !("exportAsync" in n))
            throw new Error("node not found");
        return n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
    },
};
function findDocNode(docId) {
    const n = figma.root.findAllWithCriteria({ types: [...DOC_TYPES], pluginData: { keys: [PD.docId] } }).find((x) => x.getPluginData(PD.docId) === docId);
    if (!n)
        throw new Error("Doc frame not found.");
    return n;
}
function pageNodeOf(n) {
    let p = n;
    while (p && p.type !== "PAGE")
        p = p.parent;
    return p;
}
const pageOf = (n) => pageNodeOf(n)?.name ?? "";
// ---------- snapshot: SceneNode -> NodeLike ----------
function hasVisiblePaint(n) {
    const vis = (paints) => Array.isArray(paints) && paints.some((p) => p.visible !== false && (p.opacity ?? 1) > 0);
    if ("fills" in n && vis(n.fills))
        return true;
    if ("strokes" in n && vis(n.strokes) && (("strokeWeight" in n && n.strokeWeight !== 0) || !("strokeWeight" in n)))
        return true;
    if ("effects" in n && n.effects.some((e) => e.visible !== false))
        return true;
    return false;
}
async function snapshotNode(n, isRoot, styleNames) {
    const base = {
        id: n.id,
        name: n.name,
        type: n.type,
        visible: n.visible,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        hasVisiblePaint: isRoot ? false : hasVisiblePaint(n),
    };
    if ("layoutMode" in n && (n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL"))
        base.layoutMode = n.layoutMode;
    if (n.type === "TEXT") {
        base.segments = await textSegments(n, styleNames);
    }
    else if ((isRoot || ((n.type === "FRAME" || n.type === "GROUP" || n.type === "SECTION") && !base.hasVisiblePaint)) && "children" in n) {
        // Only transparent containers are ever descended into; everything else becomes one image.
        const kids = [];
        for (const c of n.children) {
            if (!c.visible || c.name.startsWith("_"))
                continue; // skipped by rule 5; no need to read them
            kids.push(await snapshotNode(c, false, styleNames));
        }
        base.children = kids;
    }
    return base;
}
async function textSegments(n, styleNames) {
    const segs = n.getStyledTextSegments([
        "fontSize",
        "fontName",
        "fontWeight",
        "listOptions",
        "indentation",
        "hyperlink",
        "textStyleId",
    ]);
    const out = [];
    for (const s of segs) {
        let styleName;
        if (s.textStyleId) {
            if (!styleNames.has(s.textStyleId)) {
                const st = await figma.getStyleByIdAsync(s.textStyleId);
                styleNames.set(s.textStyleId, st ? st.name : "");
            }
            styleName = styleNames.get(s.textStyleId) || undefined;
        }
        out.push({
            text: s.characters,
            fontSize: s.fontSize,
            fontFamily: s.fontName.family,
            fontStyle: s.fontName.style,
            fontWeight: s.fontWeight,
            list: s.listOptions.type,
            indentation: s.indentation,
            href: s.hyperlink && s.hyperlink.type === "URL" ? s.hyperlink.value : undefined,
            styleName,
        });
    }
    return out;
}
