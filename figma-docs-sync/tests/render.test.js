import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderDoc, renderSpans, escapeText } from "../src/render/markdown";
import { allFixtures, listsAndLinks, withImages } from "./fixtures/docModels";
const rel = (m) => m.path.replace(/^docs\//, "");
describe("renderDoc golden fixtures", () => {
    for (const [name, model] of Object.entries(allFixtures)) {
        it(`${name} matches golden Markdown`, () => {
            const out = renderDoc(model, { docsFolder: "docs", relPath: rel(model) });
            expect(out.markdown).toBe(readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), "utf8"));
        });
        it(`${name} is deterministic`, () => {
            const o = { docsFolder: "docs", relPath: rel(model) };
            expect(renderDoc(model, o).markdown).toBe(renderDoc(model, o).markdown);
        });
    }
});
describe("renderDoc structure", () => {
    it("front matter + generated note, links relative to the md file", () => {
        const { markdown, assets } = renderDoc(withImages, { docsFolder: "docs", relPath: "buttons.md" });
        expect(markdown.startsWith("---\ntitle: Buttons\nfigma: https://www.figma.com/design/AbCdEfGhIjKlMnOp/?node-id=12-300\ngenerated: figma-docs-sync\n---\n<!-- Generated from Figma.")).toBe(true);
        expect(assets.map((a) => a.path)).toEqual(["docs/assets/buttons/12-345.png", "docs/assets/buttons/I12-346-1-2.png"]);
        expect(markdown).toContain("![Primary button](assets/buttons/12-345.png)");
    });
    it("omits the figma link when there is no fileKey", () => {
        const { markdown } = renderDoc(listsAndLinks, { docsFolder: "docs", relPath: "content/voice.md" });
        expect(markdown).not.toContain("figma:");
    });
    it("nested doc uses ../ to reach the shared assets folder", () => {
        const { markdown } = renderDoc(listsAndLinks, { docsFolder: "docs", relPath: "content/voice.md" });
        expect(markdown).toContain("(../assets/content-voice/40-2.png)");
    });
    it("works with an empty docs folder", () => {
        const m = { ...withImages, path: "buttons.md" };
        const { assets, markdown } = renderDoc(m, { docsFolder: "", relPath: "buttons.md" });
        expect(assets[0].path).toBe("assets/buttons/12-345.png");
        expect(markdown).toContain("(assets/buttons/12-345.png)");
    });
    it("empty doc renders only the header", () => {
        const { markdown } = renderDoc({ ...withImages, blocks: [] }, { docsFolder: "docs", relPath: "buttons.md" });
        expect(markdown.endsWith("-->\n")).toBe(true);
    });
    it("quotes titles that are not safe YAML scalars", () => {
        for (const title of ["yes", "123", 'say "hi"', "a: b", "# x", "Line\nBreak"]) {
            const { markdown } = renderDoc({ ...withImages, title, blocks: [] }, { docsFolder: "docs", relPath: "b.md" });
            expect(markdown).toMatch(/^---\ntitle: ".*"\n/);
        }
    });
    it("drops empty headings/paragraphs/list items", () => {
        const m = { ...withImages, blocks: [{ type: "heading", level: 2, spans: [{ text: "  " }] }, { type: "paragraph", spans: [] }, { type: "list", ordered: true, items: [[{ text: "a" }], [{ text: " " }], [{ text: "b" }]] }] };
        const { markdown } = renderDoc(m, { docsFolder: "docs", relPath: "b.md" });
        expect(markdown.split("-->\n")[1]).toBe("\n1. a\n2. b\n");
    });
});
describe("inline rendering", () => {
    it("moves whitespace outside emphasis markers and merges equal neighbours", () => {
        expect(renderSpans([{ text: "a ", bold: true }, { text: "b ", bold: true }, { text: "c" }])).toBe("**a b** c");
        expect(renderSpans([{ text: "x" }, { text: " y ", italic: true }, { text: "z" }])).toBe("x *y* z");
    });
    it("code spans handle backticks", () => {
        expect(renderSpans([{ text: "a`b", code: true }])).toBe("``a`b``");
        expect(renderSpans([{ text: "`x`", code: true }])).toBe("`` `x` ``");
    });
    it("code is not escaped, text is", () => {
        expect(renderSpans([{ text: "a*b", code: true }])).toBe("`a*b`");
        expect(renderSpans([{ text: "a*b" }])).toBe("a\\*b");
    });
    it("escapes block syntax only at the start", () => {
        expect(escapeText("# x")).toBe("\\# x");
        expect(escapeText("- x")).toBe("\\- x");
        expect(escapeText("> x")).toBe("\\> x");
        expect(escapeText("12. x")).toBe("12\\. x");
        expect(escapeText("a - b # c")).toBe("a - b # c");
        expect(escapeText("snake_case _x_")).toBe("snake_case \\_x\\_");
        expect(escapeText("&amp; & AT&T")).toBe("&amp;amp; & AT&T");
    });
    it("bold+italic+link nests link outermost", () => {
        expect(renderSpans([{ text: "go", bold: true, italic: true, href: "https://a.b" }])).toBe("[***go***](https://a.b)");
    });
    it("treats Figma line separators as spaces", () => {
        expect(escapeText("a b")).toBe("a b");
    });
});
