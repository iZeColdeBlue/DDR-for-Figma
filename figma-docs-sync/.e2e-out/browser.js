"use strict";
var H = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // tests/e2e/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    buildDoc: () => buildDoc,
    frame: () => frame,
    resetIds: () => resetIds,
    seg: () => seg,
    shape: () => shape,
    text: () => text
  });

  // src/extract/extract.ts
  var CONTAINER_TYPES = /* @__PURE__ */ new Set(["FRAME", "GROUP", "SECTION"]);
  var MONO_RE = /mono|courier|consolas|menlo|monaco|source code|fira code|jetbrains/i;
  function isSkipped(n2) {
    return n2.visible === false || n2.name.startsWith("_");
  }
  function extractDoc(root, meta) {
    const items = collectItems(root);
    const sizes = fontSizeRanks(items);
    const blocks = [];
    for (const it of items) {
      if (it.kind === "image") {
        blocks.push({ type: "image", alt: it.node.name, nodeId: it.node.id });
      } else {
        pushTextBlocks(blocks, it.node, sizes);
      }
    }
    return {
      docId: meta.docId,
      title: root.name,
      path: meta.path,
      figma: { fileKey: meta.fileKey, nodeId: root.id },
      blocks
    };
  }
  function collectItems(container) {
    const out = [];
    for (const child of orderChildren(container)) {
      if (isSkipped(child)) continue;
      if (child.type === "TEXT") {
        out.push({ kind: "text", node: child });
      } else if (CONTAINER_TYPES.has(child.type) && !child.hasVisiblePaint) {
        out.push(...collectItems(child));
      } else {
        out.push({ kind: "image", node: child });
      }
    }
    return out;
  }
  function orderChildren(container) {
    const kids = (container.children ?? []).filter((c) => c.visible !== false);
    const lm = container.layoutMode;
    if (lm === "HORIZONTAL" || lm === "VERTICAL") return kids;
    const sorted = [...kids].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const n2 of sorted) {
      const row = rows.find((r) => overlapRatio(r.top, r.bottom, n2.y, n2.y + n2.height) > 0.5);
      if (row) {
        row.nodes.push(n2);
        row.top = Math.min(row.top, n2.y);
        row.bottom = Math.max(row.bottom, n2.y + n2.height);
      } else {
        rows.push({ top: n2.y, bottom: n2.y + n2.height, nodes: [n2] });
      }
    }
    rows.sort((a, b) => a.top - b.top);
    return rows.flatMap((r) => r.nodes.sort((a, b) => a.x - b.x));
  }
  function overlapRatio(aTop, aBottom, bTop, bBottom) {
    const overlap = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
    const minH = Math.min(aBottom - aTop, bBottom - bTop);
    if (overlap <= 0) return 0;
    if (minH <= 0) return 1;
    return overlap / minH;
  }
  function fontSizeRanks(items) {
    const chars = /* @__PURE__ */ new Map();
    for (const it of items) {
      if (it.kind !== "text") continue;
      for (const s of it.node.segments ?? []) {
        const n2 = s.text.replace(/\s/g, "").length;
        if (n2) chars.set(s.fontSize, (chars.get(s.fontSize) ?? 0) + n2);
      }
    }
    let body = 0;
    let best = -1;
    for (const [size, n2] of chars) {
      if (n2 > best || n2 === best && size < body) {
        best = n2;
        body = size;
      }
    }
    const larger = [...chars.keys()].filter((s) => s > body).sort((a, b) => b - a);
    return { body, larger };
  }
  function levelFromStyleName(name) {
    const n2 = name.trim();
    const h = /(?:^|[^A-Za-z0-9])(?:h|heading\s*)([1-6])(?![0-9])/i.exec(n2);
    if (h) return Math.min(parseInt(h[1], 10), 4);
    if (/sub-?title|sub-?heading/i.test(n2)) return 2;
    if (/(?:^|[^A-Za-z])title(?:[^A-Za-z]|$)/i.test(n2)) return 1;
    if (/(?:^|[^A-Za-z])(body|paragraph|caption|label|text)(?:[^A-Za-z]|$)/i.test(n2)) return "paragraph";
    return void 0;
  }
  function headingLevel(seg2, sizes) {
    if (seg2.styleName) {
      const fromStyle = levelFromStyleName(seg2.styleName);
      if (fromStyle === "paragraph") return void 0;
      if (fromStyle) return fromStyle;
    }
    const rank = sizes.larger.indexOf(seg2.fontSize);
    if (rank < 0) return void 0;
    return Math.min(rank + 1, 4);
  }
  function pushTextBlocks(blocks, node, sizes) {
    let open = null;
    for (const para of splitParagraphs(node.segments ?? [])) {
      if (!para.text.trim()) continue;
      const first = para.first;
      if (first.list !== "NONE") {
        const ordered = first.list === "ORDERED";
        if (open && open.ordered === ordered) {
          open.items.push(para.spans);
        } else {
          open = { type: "list", ordered, items: [para.spans] };
          blocks.push(open);
        }
        continue;
      }
      open = null;
      const level = headingLevel(first, sizes);
      if (level) blocks.push({ type: "heading", level, spans: para.spans });
      else blocks.push({ type: "paragraph", spans: para.spans });
    }
  }
  function splitParagraphs(segments) {
    const paras = [];
    let cur = { spans: [], text: "" };
    const flush = () => {
      if (cur.first || cur.text) {
        paras.push({ spans: cur.spans, first: cur.first, text: cur.text });
      }
      cur = { spans: [], text: "" };
    };
    for (const seg2 of segments) {
      const pieces = seg2.text.split(/\r\n|\n|\r/);
      pieces.forEach((piece, i) => {
        if (i > 0) flush();
        if (piece === "") {
          if (!cur.first) cur.first = seg2;
          return;
        }
        if (!cur.first || !cur.text.trim()) cur.first = seg2;
        cur.spans.push(toSpan(piece, seg2));
        cur.text += piece;
      });
    }
    flush();
    return paras.filter((p) => p.first);
  }
  function toSpan(text2, s) {
    const span = { text: text2 };
    if (s.fontWeight >= 600 || /bold|black|heavy/i.test(s.fontStyle)) span.bold = true;
    if (/italic|oblique/i.test(s.fontStyle)) span.italic = true;
    if (MONO_RE.test(s.fontFamily)) span.code = true;
    if (s.href) span.href = s.href;
    return span;
  }

  // src/paths.ts
  function joinPath(...parts) {
    return parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter((p) => p !== "").join("/");
  }
  function dirname(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }
  function relativePath(fromFile, toFile) {
    const from = dirname(fromFile).split("/").filter(Boolean);
    const to = toFile.split("/").filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    const ups = from.slice(i).map(() => "..");
    return [...ups, ...to.slice(i)].join("/");
  }
  function nodeIdToFile(nodeId) {
    return nodeId.replace(/[^A-Za-z0-9_-]/g, "-");
  }
  function assetSlug(relPath) {
    return relPath.replace(/\.md$/i, "").split("/").filter(Boolean).join("-");
  }
  function assetPath(docsFolder, relPath, nodeId) {
    return joinPath(docsFolder, "assets", assetSlug(relPath), nodeIdToFile(nodeId) + ".png");
  }

  // src/render/markdown.ts
  var GENERATED_NOTE = "<!-- Generated from Figma. Edit the Figma frame, not this file. -->";
  function renderDoc(model, opts) {
    const assets = [];
    const parts = [];
    for (const block of model.blocks) {
      const out = renderBlock(block, model, opts, assets);
      if (out) parts.push(out);
    }
    const head = frontMatter(model);
    const body = parts.join("\n\n");
    const markdown = head + GENERATED_NOTE + "\n" + (body ? "\n" + body + "\n" : "");
    return { markdown, assets };
  }
  function renderBlock(block, model, opts, assets) {
    switch (block.type) {
      case "heading": {
        const text2 = renderSpans(block.spans.map((s) => ({ ...s, bold: false })));
        return text2 ? "#".repeat(block.level) + " " + text2 : "";
      }
      case "paragraph":
        return renderSpans(block.spans);
      case "list": {
        const lines = block.items.map((item, i) => ({ item, text: renderSpans(item) })).filter((x) => x.text).map((x, i) => (block.ordered ? `${i + 1}. ` : "- ") + x.text);
        return lines.join("\n");
      }
      case "image": {
        const path = assetPath(opts.docsFolder, opts.relPath, block.nodeId);
        assets.push({ nodeId: block.nodeId, path });
        const rel = relativePath(model.path, path);
        return `![${escapeAlt(block.alt)}](${encodeUrl(rel)})`;
      }
    }
  }
  function frontMatter(model) {
    const lines = ["---", `title: ${yamlString(model.title)}`];
    const url = figmaUrl(model);
    if (url) lines.push(`figma: ${url}`);
    lines.push("generated: figma-docs-sync", "---");
    return lines.join("\n") + "\n";
  }
  function figmaUrl(model) {
    const { fileKey, nodeId } = model.figma;
    if (!fileKey) return void 0;
    return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, "-")}`;
  }
  function yamlString(s) {
    const plain = /^[A-Za-z0-9][A-Za-z0-9 ._()\/-]*$/.test(s) && !s.endsWith(" ");
    const reserved = /^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) || /^[0-9.\-_ ]+$/.test(s);
    return plain && !reserved ? s : JSON.stringify(s.replace(/[\r\n]+/g, " "));
  }
  function renderSpans(spans) {
    return mergeSpans(spans).map(renderSpan).join("").replace(/\s+$/g, "").replace(/^\s+/g, "");
  }
  function sameFmt(a, b) {
    return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code && a.href === b.href;
  }
  function mergeSpans(spans) {
    const out = [];
    for (const s of spans) {
      if (!s.text) continue;
      const last = out[out.length - 1];
      if (last && sameFmt(last, s)) last.text += s.text;
      else out.push({ ...s });
    }
    return out;
  }
  function renderSpan(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text);
    const [lead, core, trail] = [m[1], m[2], m[3]];
    if (!core) return s.text;
    let t = s.code ? codeSpan(core) : escapeText(core);
    if (s.bold && s.italic) t = `***${t}***`;
    else if (s.bold) t = `**${t}**`;
    else if (s.italic) t = `*${t}*`;
    if (s.href) t = `[${t}](${encodeUrl(s.href)})`;
    return lead + t + trail;
  }
  function codeSpan(text2) {
    const runs = text2.match(/`+/g) ?? [];
    const longest = runs.reduce((n2, r) => Math.max(n2, r.length), 0);
    const fence = "`".repeat(longest + 1);
    const pad = text2.startsWith("`") || text2.endsWith("`") ? " " : "";
    return fence + pad + text2 + pad + fence;
  }
  function escapeText(text2) {
    let t = text2.replace(/\u2028|\u2029/g, " ").replace(/[\\`*<\[\]]/g, "\\$&").replace(/(^|[^A-Za-z0-9])_|_(?=$|[^A-Za-z0-9])/g, (m) => m.replace("_", "\\_")).replace(/~~/g, "\\~\\~").replace(/&(?=#?\w+;)/g, "&amp;");
    t = t.replace(/^(\s*)(#{1,6}(?=\s|$)|[-+>](?=\s|$))/, "$1\\$2");
    t = t.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3");
    return t;
  }
  function escapeAlt(alt) {
    return alt.replace(/[\r\n]+/g, " ").replace(/[\\\[\]]/g, "\\$&");
  }
  function encodeUrl(url) {
    return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");
  }

  // src/sync/sha1.ts
  var hex = (n2) => (n2 >>> 0).toString(16).padStart(8, "0");
  function sha1Hex(data) {
    const len = data.length;
    const total = (len + 8 >> 6) + 1 << 6;
    const buf = new Uint8Array(total);
    buf.set(data);
    buf[len] = 128;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len * 8 / 4294967296), false);
    dv.setUint32(total - 4, len * 8 >>> 0, false);
    let h0 = 1732584193, h1 = 4023233417, h2 = 2562383102, h3 = 271733878, h4 = 3285377520;
    const w = new Uint32Array(80);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = x << 1 | x >>> 31;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = b & c | ~b & d;
          k = 1518500249;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 1859775393;
        } else if (i < 60) {
          f = b & c | b & d | c & d;
          k = 2400959708;
        } else {
          f = b ^ c ^ d;
          k = 3395469782;
        }
        const t = (a << 5 | a >>> 27) + f + e + k + w[i] | 0;
        e = d;
        d = c;
        c = b << 30 | b >>> 2;
        b = a;
        a = t;
      }
      h0 = h0 + a | 0;
      h1 = h1 + b | 0;
      h2 = h2 + c | 0;
      h3 = h3 + d | 0;
      h4 = h4 + e | 0;
    }
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
  }
  function gitBlobSha(bytes) {
    const header = utf8(`blob ${bytes.length}\0`);
    const all = new Uint8Array(header.length + bytes.length);
    all.set(header);
    all.set(bytes, header.length);
    return sha1Hex(all);
  }
  function utf8(s) {
    const out = new Uint8Array(s.length * 3);
    let n2 = 0;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 55296 && c <= 57343) {
        const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (c <= 56319 && next >= 56320 && next <= 57343) {
          c = 65536 + (c - 55296 << 10) + (next - 56320);
          i++;
        } else {
          c = 65533;
        }
      }
      if (c < 128) {
        out[n2++] = c;
      } else if (c < 2048) {
        out[n2++] = 192 | c >> 6;
        out[n2++] = 128 | c & 63;
      } else if (c < 65536) {
        out[n2++] = 224 | c >> 12;
        out[n2++] = 128 | c >> 6 & 63;
        out[n2++] = 128 | c & 63;
      } else {
        out[n2++] = 240 | c >> 18;
        out[n2++] = 128 | c >> 12 & 63;
        out[n2++] = 128 | c >> 6 & 63;
        out[n2++] = 128 | c & 63;
      }
    }
    return out.slice(0, n2);
  }

  // src/build.ts
  async function buildDoc(input) {
    const path = joinPath(input.docsFolder, input.relPath);
    const model = extractDoc(input.snapshot, { docId: input.docId, path, fileKey: input.fileKey });
    const warnings = [];
    const png = /* @__PURE__ */ new Map();
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
    const files = [{ path, bytes: utf8(markdown), sha: "" }];
    for (const a of assets) files.push({ path: a.path, bytes: png.get(a.nodeId), sha: "" });
    for (const f of files) f.sha = gitBlobSha(f.bytes);
    return { docId: input.docId, title: model.title, relPath: input.relPath, path, nodeId: model.figma.nodeId, markdown, files, warnings };
  }

  // tests/helpers/fakeNodes.ts
  var n = 100;
  var resetIds = () => n = 100;
  var seg = (text2, o = {}) => ({
    text: text2,
    fontSize: 16,
    fontFamily: "Inter",
    fontStyle: "Regular",
    fontWeight: 400,
    list: "NONE",
    ...o
  });
  var geo = (p) => ({ x: p.x ?? 0, y: p.y ?? 0, width: p.w ?? 100, height: p.h ?? 20 });
  var text = (name, segments, p = {}) => ({
    id: `1:${++n}`,
    name,
    type: "TEXT",
    visible: p.visible ?? true,
    hasVisiblePaint: true,
    segments,
    ...geo(p)
  });
  var shape = (name, p = {}) => ({
    id: `1:${++n}`,
    name,
    type: p.type ?? "RECTANGLE",
    visible: p.visible ?? true,
    hasVisiblePaint: true,
    ...geo({ h: 40, ...p })
  });
  var frame = (name, children, p = {}) => ({
    id: p.id ?? `1:${++n}`,
    name,
    type: p.type ?? "FRAME",
    visible: p.visible ?? true,
    hasVisiblePaint: p.paint ?? false,
    layoutMode: p.layout,
    children,
    ...geo({ w: 600, h: 800, ...p })
  });
  return __toCommonJS(browser_exports);
})();
