import { nodeIdToFile } from "../paths";
const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION"]);
const MONO_RE = /mono|courier|consolas|menlo|monaco|source code|fira code|jetbrains/i;
export function isSkipped(n) {
    return n.visible === false || n.name.startsWith("_");
}
export function extractDoc(root, meta) {
    const items = collectItems(root); // reading-ordered leaf items
    const sizes = fontSizeRanks(items);
    const blocks = [];
    for (const it of items) {
        if (it.kind === "image") {
            blocks.push({ type: "image", assetId: nodeIdToFile(it.node.id), alt: it.node.name, nodeId: it.node.id });
        }
        else {
            pushTextBlocks(blocks, it.node, sizes);
        }
    }
    return {
        docId: meta.docId,
        title: root.name,
        path: meta.path,
        figma: { fileKey: meta.fileKey, nodeId: root.id },
        blocks,
    };
}
function collectItems(container) {
    const out = [];
    for (const child of orderChildren(container)) {
        if (isSkipped(child))
            continue;
        if (child.type === "TEXT") {
            out.push({ kind: "text", node: child });
        }
        else if (CONTAINER_TYPES.has(child.type) && !child.hasVisiblePaint) {
            out.push(...collectItems(child)); // transparent container: recurse
        }
        else {
            out.push({ kind: "image", node: child }); // rule 4: anything else becomes an image
        }
    }
    return out;
}
/** Auto-layout order if set, otherwise top-to-bottom rows (>50% y-overlap), left-to-right within a row. */
export function orderChildren(container) {
    const kids = (container.children ?? []).filter((c) => c.visible !== false);
    const lm = container.layoutMode;
    if (lm === "HORIZONTAL" || lm === "VERTICAL")
        return kids;
    const sorted = [...kids].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const n of sorted) {
        const row = rows.find((r) => overlapRatio(r.top, r.bottom, n.y, n.y + n.height) > 0.5);
        if (row) {
            row.nodes.push(n);
            row.top = Math.min(row.top, n.y);
            row.bottom = Math.max(row.bottom, n.y + n.height);
        }
        else {
            rows.push({ top: n.y, bottom: n.y + n.height, nodes: [n] });
        }
    }
    rows.sort((a, b) => a.top - b.top);
    return rows.flatMap((r) => r.nodes.sort((a, b) => a.x - b.x));
}
function overlapRatio(aTop, aBottom, bTop, bBottom) {
    const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
    const minH = Math.min(aBottom - aTop, bBottom - bTop);
    if (overlap <= 0)
        return 0;
    if (minH <= 0)
        return 1; // zero-height node lying inside the row's span
    return overlap / minH;
}
function fontSizeRanks(items) {
    const chars = new Map();
    for (const it of items) {
        if (it.kind !== "text")
            continue;
        for (const s of it.node.segments ?? []) {
            const n = s.text.replace(/\s/g, "").length;
            if (n)
                chars.set(s.fontSize, (chars.get(s.fontSize) ?? 0) + n);
        }
    }
    let body = 0;
    let best = -1;
    for (const [size, n] of chars) {
        if (n > best || (n === best && size < body)) {
            best = n;
            body = size;
        }
    }
    const larger = [...chars.keys()].filter((s) => s > body).sort((a, b) => b - a);
    return { body, larger };
}
/** Level from a text style name, "paragraph" if the style is clearly body text, or undefined if unrecognised. */
export function levelFromStyleName(name) {
    const n = name.trim();
    const h = /(?:^|[^A-Za-z0-9])(?:h|heading\s*)([1-6])(?![0-9])/i.exec(n);
    if (h)
        return Math.min(parseInt(h[1], 10), 4);
    if (/sub-?title|sub-?heading/i.test(n))
        return 2;
    if (/(?:^|[^A-Za-z])title(?:[^A-Za-z]|$)/i.test(n))
        return 1;
    if (/(?:^|[^A-Za-z])(body|paragraph|caption|label|text)(?:[^A-Za-z]|$)/i.test(n))
        return "paragraph";
    return undefined;
}
function headingLevel(seg, sizes) {
    if (seg.styleName) {
        const fromStyle = levelFromStyleName(seg.styleName);
        if (fromStyle === "paragraph")
            return undefined;
        if (fromStyle)
            return fromStyle;
    }
    const rank = sizes.larger.indexOf(seg.fontSize);
    if (rank < 0)
        return undefined;
    return Math.min(rank + 1, 4);
}
function pushTextBlocks(blocks, node, sizes) {
    // Consecutive list paragraphs of the same kind within ONE text node form one list.
    let open = null;
    for (const para of splitParagraphs(node.segments ?? [])) {
        if (!para.text.trim())
            continue;
        const first = para.first;
        if (first.list !== "NONE") {
            const ordered = first.list === "ORDERED";
            if (open && open.ordered === ordered) {
                open.items.push(para.spans);
            }
            else {
                open = { type: "list", ordered, items: [para.spans] };
                blocks.push(open);
            }
            continue;
        }
        open = null;
        const level = headingLevel(first, sizes);
        if (level)
            blocks.push({ type: "heading", level, spans: para.spans });
        else
            blocks.push({ type: "paragraph", spans: para.spans });
    }
}
/** Split styled segments on newlines; paragraph properties come from the paragraph's first non-blank segment. */
function splitParagraphs(segments) {
    const paras = [];
    let cur = { spans: [], text: "" };
    const flush = () => {
        if (cur.first || cur.text) {
            paras.push({ spans: cur.spans, first: cur.first, text: cur.text });
        }
        cur = { spans: [], text: "" };
    };
    for (const seg of segments) {
        const pieces = seg.text.split(/\r\n|\n|\r/);
        pieces.forEach((piece, i) => {
            if (i > 0)
                flush();
            if (piece === "") {
                if (!cur.first)
                    cur.first = seg; // keeps list/size info for an empty-start paragraph
                return;
            }
            if (!cur.first || !cur.text.trim())
                cur.first = seg;
            cur.spans.push(toSpan(piece, seg));
            cur.text += piece;
        });
    }
    flush();
    return paras.filter((p) => p.first);
}
function toSpan(text, s) {
    const span = { text };
    if (s.fontWeight >= 600 || /bold|black|heavy/i.test(s.fontStyle))
        span.bold = true;
    if (/italic|oblique/i.test(s.fontStyle))
        span.italic = true;
    if (MONO_RE.test(s.fontFamily))
        span.code = true;
    if (s.href)
        span.href = s.href;
    return span;
}
