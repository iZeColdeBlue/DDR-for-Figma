import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../src/ui/preview";
import { renderDoc } from "../src/render/markdown";
import { allFixtures } from "./fixtures/docModels";

const noImg = () => undefined;

describe("preview renderer", () => {
  it("renders every fixture's generated Markdown without leaking syntax", () => {
    for (const m of Object.values(allFixtures)) {
      const { markdown } = renderDoc(m, { docsFolder: "docs", relPath: m.path.replace(/^docs\//, "") });
      const html = markdownToHtml(markdown, (u) => "blob:" + u);
      expect(html).not.toContain("generated: figma-docs-sync");
      expect(html).not.toContain("<!--");
      expect(html).not.toMatch(/\*\*|\\\*/);
    }
  });
  it("headings, lists, emphasis, code, links, images", () => {
    const html = markdownToHtml("# T\n\nhello **b** *i* `c` [l](https://a.b)\n\n- x\n- y\n\n1. a\n2. b\n\n![alt](assets/a.png)\n", (u) => (u === "assets/a.png" ? "blob:1" : undefined));
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<strong>b</strong> <em>i</em> <code>c</code> <a href=\"https://a.b\">l</a>");
    expect(html).toContain("<ul><li>x</li><li>y</li></ul>");
    expect(html).toContain("<ol><li>a</li><li>b</li></ol>");
    expect(html).toContain('<img alt="alt" src="blob:1">');
  });
  it("escapes HTML and honours backslash escapes", () => {
    expect(markdownToHtml("\\<b>x\\</b> & <script>", noImg)).toBe("<p>&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;</p>");
    expect(markdownToHtml("2 \\* 3", noImg)).toBe("<p>2 * 3</p>");
  });
  it("blocks javascript: links and shows missing images", () => {
    expect(markdownToHtml("[x](javascript:alert(1))", noImg)).not.toContain("javascript:alert");
    expect(markdownToHtml("![a](missing.png)", noImg)).toContain("missing image");
  });
  it("does not throw on a stray % in a link or image path", () => {
    expect(markdownToHtml("[x](https://a.b/100%)", noImg)).toContain('href="https://a.b/100%"');
    expect(markdownToHtml("![a](d%/x.png)", noImg)).toContain("missing image");
  });
});
