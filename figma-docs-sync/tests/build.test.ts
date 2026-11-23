import { describe, expect, it } from "vitest";
import { buildDoc } from "../src/build";
import { frame, resetIds, seg, shape, text } from "./helpers/fakeNodes";
import { gitBlobSha } from "../src/sync/sha1";

describe("buildDoc", () => {
  it("produces md + png files with real git blob SHAs, deterministic across runs", async () => {
    resetIds();
    const root = frame("Doc", [text("t", [seg("Hi")], { y: 0 }), shape("Img", { type: "INSTANCE", y: 50 })], { id: "9:9" });
    const exportPng = async () => new Uint8Array([1, 2, 3]);
    const mk = () => buildDoc({ snapshot: root, docId: "D", relPath: "doc.md", docsFolder: "docs", fileKey: "KEYKEYKEYKEY", exportPng });
    const a = await mk();
    const b = await mk();
    expect(a.files.map((f) => f.path)).toEqual(["docs/doc.md", "docs/assets/doc/1-102.png"]);
    for (const f of a.files) expect(f.sha).toBe(gitBlobSha(f.bytes));
    expect(a.files.map((f) => f.sha)).toEqual(b.files.map((f) => f.sha));
    expect(a.markdown).toBe(b.markdown);
  });
  it("an image that fails to export is dropped from the Markdown with a warning (no broken link)", async () => {
    resetIds();
    const bad = shape("Divider", { type: "LINE", y: 0, h: 0 });
    const ok = shape("Good", { type: "RECTANGLE", y: 50 });
    const out = await buildDoc({
      snapshot: frame("Doc", [bad, ok]),
      docId: "D",
      relPath: "d.md",
      docsFolder: "docs",
      exportPng: async (id) => {
        if (id === bad.id) throw new Error("zero size");
        return new Uint8Array([9]);
      },
    });
    expect(out.warnings).toEqual(['Skipped image "Divider": could not export (zero size).']);
    expect(out.markdown).not.toContain("Divider");
    expect(out.markdown).toContain("![Good]");
    expect(out.files.length).toBe(2);
  });
  it("empty export bytes count as failure", async () => {
    resetIds();
    const r = shape("X", { y: 0 });
    const out = await buildDoc({ snapshot: frame("Doc", [r]), docId: "D", relPath: "d.md", docsFolder: "", exportPng: async () => new Uint8Array(0) });
    expect(out.warnings.length).toBe(1);
    expect(out.files.length).toBe(1);
  });
});
