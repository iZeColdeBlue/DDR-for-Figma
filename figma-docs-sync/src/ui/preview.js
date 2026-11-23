// Tiny Markdown -> HTML renderer for the Preview pane. It only has to understand the subset that
// render/markdown.ts emits, which also makes the preview a check of the generated Markdown itself.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function markdownToHtml(md, resolveImage) {
    let text = md.replace(/\r\n/g, "\n");
    text = text.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "");
    const out = [];
    for (const block of text.split(/\n{2,}/)) {
        const b = block.replace(/^\n+|\n+$/g, "");
        if (!b)
            continue;
        const h = /^(#{1,6}) (.*)$/.exec(b);
        if (h && !b.includes("\n")) {
            out.push(`<h${h[1].length}>${inline(h[2], resolveImage)}</h${h[1].length}>`);
            continue;
        }
        const lines = b.split("\n");
        if (lines.every((l) => /^- /.test(l))) {
            out.push("<ul>" + lines.map((l) => `<li>${inline(l.slice(2), resolveImage)}</li>`).join("") + "</ul>");
            continue;
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
            out.push("<ol>" + lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ""), resolveImage)}</li>`).join("") + "</ol>");
            continue;
        }
        out.push(`<p>${inline(b, resolveImage)}</p>`);
    }
    return out.join("\n");
}
function safeHref(u) {
    const url = decodeURI(u);
    return /^(https?:|mailto:|#|[^:]*$)/i.test(url) ? esc(u) : "#";
}
export function inline(s, resolveImage) {
    let out = "";
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === "\\" && i + 1 < s.length) {
            out += esc(s[i + 1]);
            i += 2;
        }
        else if (c === "`") {
            let n = 0;
            while (s[i + n] === "`")
                n++;
            const fence = "`".repeat(n);
            const end = s.indexOf(fence, i + n);
            if (end < 0) {
                out += fence;
                i += n;
            }
            else {
                out += `<code>${esc(s.slice(i + n, end).replace(/^ (.*) $/, "$1"))}</code>`;
                i = end + n;
            }
        }
        else if (c === "!" && s[i + 1] === "[") {
            const m = /^!\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)\)/.exec(s.slice(i));
            if (m) {
                const src = resolveImage(decodeURI(m[2]));
                out += src ? `<img alt="${esc(m[1].replace(/\\(.)/g, "$1"))}" src="${esc(src)}">` : `<em>[missing image ${esc(m[2])}]</em>`;
                i += m[0].length;
            }
            else {
                out += "!";
                i++;
            }
        }
        else if (c === "[") {
            const close = findClosing(s, i);
            const m = close >= 0 ? /^\(([^)\s]*)\)/.exec(s.slice(close + 1)) : null;
            if (m) {
                out += `<a href="${safeHref(m[1])}">${inline(s.slice(i + 1, close), resolveImage)}</a>`;
                i = close + 1 + m[0].length;
            }
            else {
                out += "[";
                i++;
            }
        }
        else if (c === "*") {
            let n = 0;
            while (s[i + n] === "*" && n < 3)
                n++;
            const fence = "*".repeat(n);
            const end = s.indexOf(fence, i + n);
            if (end > i + n) {
                const tag = n === 3 ? ["<strong><em>", "</em></strong>"] : n === 2 ? ["<strong>", "</strong>"] : ["<em>", "</em>"];
                out += tag[0] + inline(s.slice(i + n, end), resolveImage) + tag[1];
                i = end + n;
            }
            else {
                out += esc(fence);
                i += n;
            }
        }
        else {
            out += esc(c);
            i++;
        }
    }
    return out;
}
function findClosing(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === "\\")
            i++;
        else if (s[i] === "[")
            depth++;
        else if (s[i] === "]" && --depth === 0)
            return i;
    }
    return -1;
}
