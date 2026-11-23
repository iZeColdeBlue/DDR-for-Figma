// render layer: DocModel -> Markdown + asset list. Pure; no Figma dependency.
import type { AssetRef, Block, DocModel, Span } from "../types";
import { assetPath, relativePath } from "../paths";

export type RenderOptions = {
  /** Docs folder in the repo (assets go to <docsFolder>/assets/<slug>/). */
  docsFolder: string;
  /** doc path relative to docsFolder, used for the asset slug. */
  relPath: string;
};

export type RenderResult = { markdown: string; assets: AssetRef[] };

const GENERATED_NOTE = "<!-- Generated from Figma. Edit the Figma frame, not this file. -->";

export function renderDoc(model: DocModel, opts: RenderOptions): RenderResult {
  const assets: AssetRef[] = [];
  const parts: string[] = [];

  for (const block of model.blocks) {
    const out = renderBlock(block, model, opts, assets);
    if (out) parts.push(out);
  }

  const head = frontMatter(model);
  const body = parts.join("\n\n");
  const markdown = head + GENERATED_NOTE + "\n" + (body ? "\n" + body + "\n" : "");
  return { markdown, assets };
}

function renderBlock(block: Block, model: DocModel, opts: RenderOptions, assets: AssetRef[]): string {
  switch (block.type) {
    case "heading": {
      const text = renderSpans(block.spans.map((s) => ({ ...s, bold: false })));
      return text ? "#".repeat(block.level) + " " + text : "";
    }
    case "paragraph":
      return renderSpans(block.spans);
    case "list": {
      const lines = block.items
        .map((item, i) => ({ item, text: renderSpans(item) }))
        .filter((x) => x.text)
        .map((x, i) => (block.ordered ? `${i + 1}. ` : "- ") + x.text);
      return lines.join("\n");
    }
    case "image": {
      const path = assetPath(opts.docsFolder, opts.relPath, block.nodeId);
      assets.push({ assetId: block.assetId, nodeId: block.nodeId, path });
      const rel = relativePath(model.path, path);
      return `![${escapeAlt(block.alt)}](${encodeUrl(rel)})`;
    }
  }
}

// ---------- front matter ----------

function frontMatter(model: DocModel): string {
  const lines = ["---", `title: ${yamlString(model.title)}`];
  const url = figmaUrl(model);
  if (url) lines.push(`figma: ${url}`);
  lines.push("generated: figma-docs-sync", "---");
  return lines.join("\n") + "\n";
}

export function figmaUrl(model: DocModel): string | undefined {
  const { fileKey, nodeId } = model.figma;
  if (!fileKey) return undefined;
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, "-")}`;
}

function yamlString(s: string): string {
  const plain = /^[A-Za-z0-9][A-Za-z0-9 ._()\/-]*$/.test(s) && !s.endsWith(" ");
  const reserved = /^(true|false|yes|no|on|off|null|~|y|n)$/i.test(s) || /^[0-9.\-_ ]+$/.test(s);
  return plain && !reserved ? s : JSON.stringify(s.replace(/[\r\n]+/g, " "));
}

// ---------- inline rendering ----------

export function renderSpans(spans: Span[]): string {
  return mergeSpans(spans)
    .map(renderSpan)
    .join("")
    .replace(/\s+$/g, "")
    .replace(/^\s+/g, "");
}

function sameFmt(a: Span, b: Span): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code && a.href === b.href;
}

function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && sameFmt(last, s)) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

function renderSpan(s: Span): string {
  // Markers must hug the text: move surrounding whitespace outside.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text) as RegExpExecArray;
  const [lead, core, trail] = [m[1], m[2], m[3]];
  if (!core) return s.text;
  let t = s.code ? codeSpan(core) : escapeText(core);
  if (s.bold && s.italic) t = `***${t}***`;
  else if (s.bold) t = `**${t}**`;
  else if (s.italic) t = `*${t}*`;
  if (s.href) t = `[${t}](${encodeUrl(s.href)})`;
  return lead + t + trail;
}

function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + pad + text + pad + fence;
}

export function escapeText(text: string): string {
  let t = text
    .replace(/\u2028|\u2029/g, " ")
    .replace(/[\\`*<\[\]]/g, "\\$&")
    .replace(/(^|[^A-Za-z0-9])_|_(?=$|[^A-Za-z0-9])/g, (m) => m.replace("_", "\\_"))
    .replace(/~~/g, "\\~\\~")
    .replace(/&(?=#?\w+;)/g, "&amp;");
  // Block-level syntax at the start of the text.
  t = t.replace(/^(\s*)(#{1,6}(?=\s|$)|[-+>](?=\s|$))/, "$1\\$2");
  t = t.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3");
  return t;
}

function escapeAlt(alt: string): string {
  return alt.replace(/[\r\n]+/g, " ").replace(/[\\\[\]]/g, "\\$&");
}

function encodeUrl(url: string): string {
  return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");
}
