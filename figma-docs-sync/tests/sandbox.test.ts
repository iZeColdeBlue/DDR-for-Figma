// Figma's main-thread sandbox lacks some web APIs that Node (and the UI iframe) have.
// These tests make sure main-thread code does not depend on them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { buildDoc } from "../src/build";
import { utf8 } from "../src/sync/sha1";
import { frame, resetIds, seg, text } from "./helpers/fakeNodes";

const MISSING_IN_SANDBOX = ["TextEncoder", "TextDecoder"];

describe("utf8 (hand-written, no TextEncoder)", () => {
  it("matches TextEncoder for ASCII, accents, CJK, emoji and lone surrogates", () => {
    const samples = ["", "hello\n", "blob 12\0", "Grüße – café", "日本語", "😀👍🏽", "a\uD800b", "\uDC00", "x\uD83D", "߿ࠀ￿"];
    for (const s of samples) expect(Array.from(utf8(s))).toEqual(Array.from(new TextEncoder().encode(s)));
  });
});

describe("main-thread code without TextEncoder/TextDecoder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("buildDoc still works when the globals are missing", async () => {
    for (const g of MISSING_IN_SANDBOX) vi.stubGlobal(g, undefined);
    resetIds();
    const out = await buildDoc({
      snapshot: frame("Doc", [text("t", [seg("Grüße 😀")])]),
      docId: "D",
      relPath: "doc.md",
      docsFolder: "docs",
      fileKey: "KEYKEYKEYKEY",
      exportPng: async () => new Uint8Array([1]),
    });
    expect(out.markdown).toContain("Grüße 😀");
  });

  it("the main bundle (dist/code.js entry) never references them", async () => {
    const res = await build({ entryPoints: ["src/main.ts"], bundle: true, write: false, format: "iife", logLevel: "silent" });
    const code = res.outputFiles[0].text;
    for (const g of MISSING_IN_SANDBOX) expect(code, `${g} is not available in Figma's main thread`).not.toContain(g);
  });
});
