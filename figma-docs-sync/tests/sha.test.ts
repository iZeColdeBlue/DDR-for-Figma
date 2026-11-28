import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gitBlobSha, sha1Hex } from "../src/sync/sha1";
import { decodeBase64, encodeBase64 } from "../src/sync/base64";

describe("sha1 / git blob sha", () => {
  it("matches node crypto for many lengths (padding boundaries)", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4097]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
      expect(sha1Hex(b)).toBe(createHash("sha1").update(b).digest("hex"));
    }
  });
  it("matches `git hash-object` for text and binary", () => {
    for (const b of [new TextEncoder().encode("hello\n"), new Uint8Array([0, 255, 1, 2, 3, 0, 9]), new Uint8Array(0)]) {
      const expected = execFileSync("git", ["hash-object", "--stdin"], { input: Buffer.from(b) }).toString().trim();
      expect(gitBlobSha(b)).toBe(expected);
    }
  });
  it("known value: empty blob", () => {
    expect(gitBlobSha(new Uint8Array(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
  it("hashes a 12 MB buffer in reasonable time", () => {
    const b = new Uint8Array(12 * 1024 * 1024).map((_, i) => i & 255);
    const t = Date.now();
    gitBlobSha(b);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe("base64", () => {
  it("round-trips and matches Buffer", () => {
    for (const n of [0, 1, 2, 3, 4, 100, 49153, 100000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 7) & 255);
      const enc = encodeBase64(b);
      expect(enc).toBe(Buffer.from(b).toString("base64"));
      expect(Array.from(decodeBase64(enc))).toEqual(Array.from(b));
    }
  });
  it("decodes GitHub-style line-wrapped base64", () => {
    expect(new TextDecoder().decode(decodeBase64("aGVs\nbG8K\n"))).toBe("hello\n");
  });
});
