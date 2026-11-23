import { describe, expect, it } from "vitest";
import { assetPath, assetSlug, dirname, joinPath, nodeIdToFile, normalizeFolder, normalizeRelPath, relativePath, slugify, uniqueRelPath } from "../src/paths";
import { parseFileKey } from "../src/fileKey";
import { uuid } from "../src/uuid";

describe("paths", () => {
  it("slugify", () => {
    expect(slugify("Buttons")).toBe("buttons");
    expect(slugify("  Café & Crème – v2!  ")).toBe("cafe-creme-v2");
    expect(slugify("日本語")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
  it("folders and joins", () => {
    expect(normalizeFolder(" /docs/ ")).toBe("docs");
    expect(normalizeFolder("a\\b//c/./")).toBe("a/b/c");
    expect(normalizeFolder("")).toBe("");
    expect(joinPath("docs", "/a.md")).toBe("docs/a.md");
    expect(joinPath("", "a.md")).toBe("a.md");
    expect(dirname("docs/a/b.md")).toBe("docs/a");
    expect(dirname("b.md")).toBe("");
  });
  it("relative paths", () => {
    expect(relativePath("docs/a.md", "docs/assets/a/1.png")).toBe("assets/a/1.png");
    expect(relativePath("docs/x/a.md", "docs/assets/x-a/1.png")).toBe("../assets/x-a/1.png");
    expect(relativePath("docs/x/y/a.md", "docs/assets/q.png")).toBe("../../assets/q.png");
    expect(relativePath("a.md", "assets/a/1.png")).toBe("assets/a/1.png");
  });
  it("asset paths follow the blueprint: <docs>/assets/<slug>/<nodeId with : -> ->.png", () => {
    expect(assetPath("docs", "buttons.md", "12:345")).toBe("docs/assets/buttons/12-345.png");
    expect(assetPath("docs", "ui/buttons.md", "I1:2;3:4")).toBe("docs/assets/ui-buttons/I1-2-3-4.png");
    expect(assetSlug("a/b/c.md")).toBe("a-b-c");
    expect(nodeIdToFile("12:345")).toBe("12-345");
  });
  it("normalizeRelPath", () => {
    expect(normalizeRelPath("buttons")).toEqual({ ok: true, path: "buttons.md" });
    expect(normalizeRelPath(" /ui/Buttons.MD ")).toEqual({ ok: true, path: "ui/Buttons.MD" });
    for (const bad of ["", "  ", "../x.md", "a/../b.md", "a//b.md", "./a.md", ".md", "assets/x.md", "a\u0001.md"]) {
      expect(normalizeRelPath(bad).ok, bad).toBe(false);
    }
  });
  it("uniqueRelPath", () => {
    expect(uniqueRelPath("a.md", [])).toBe("a.md");
    expect(uniqueRelPath("a.md", ["a.md"])).toBe("a-2.md");
    expect(uniqueRelPath("a.md", ["A.md", "a-2.md"])).toBe("a-3.md");
  });
  it("parseFileKey", () => {
    expect(parseFileKey("https://www.figma.com/design/AbCdEfGhIjKlMnOp/Name?node-id=1-2")).toBe("AbCdEfGhIjKlMnOp");
    expect(parseFileKey("https://figma.com/file/AbCdEfGhIjKlMnOp")).toBe("AbCdEfGhIjKlMnOp");
    expect(parseFileKey("https://example.com/design/AbCdEfGhIjKlMnOp")).toBeUndefined();
    expect(parseFileKey("")).toBeUndefined();
  });
  it("uuid looks like v4 and is unique", () => {
    const a = uuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid()).not.toBe(a);
  });
});
