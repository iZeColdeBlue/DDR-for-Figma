import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
function walk(dir) {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}
const src = walk("src").filter((f) => f.endsWith(".ts"));
// `figma` as the global object (not the DocModel field `model.figma`, not "figma-docs-sync" strings)
const FIGMA_GLOBAL = /(?<![.\w-])figma\s*[.\[)]|typeof figma|\bSceneNode\b|\bPluginAPI\b/;
const FIGMA_WORD = /(?<![.\w-])figma(?![\w-])(?!\s*:)|\bfetch\b/;
const rel = (f) => relative("src", f).replace(/\\/g, "/");
const read = (f) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // strip comments
describe("architecture rules", () => {
    it("(control) the detector does fire on the Figma host", () => {
        expect(read("src/extract/figmaHost.ts")).toMatch(FIGMA_GLOBAL);
    });
    it("only src/extract/ touches the `figma` global", () => {
        const offenders = src.filter((f) => !rel(f).startsWith("extract/")).filter((f) => FIGMA_GLOBAL.test(read(f)));
        expect(offenders.map(rel)).toEqual([]);
    });
    it("render/ and sync/ import nothing from extract/ or the Figma host", () => {
        for (const f of src.filter((f) => /^(render|sync)\//.test(rel(f)))) {
            expect(read(f), rel(f)).not.toMatch(/from\s+["'][./]*\/?(\.\.\/)*extract/);
            expect(read(f), rel(f)).not.toMatch(/figmaHost|plugin-typings/);
        }
    });
    it("extract/ (except figmaHost) is pure: no figma global, no network", () => {
        for (const f of src.filter((f) => /^extract\//.test(rel(f)) && !rel(f).endsWith("figmaHost.ts"))) {
            expect(read(f), rel(f)).not.toMatch(FIGMA_WORD);
        }
    });
    it("the GitHub token is never written to plugin data or logs", () => {
        for (const f of src) {
            const c = read(f);
            expect(c, rel(f)).not.toMatch(/console\.(log|info|warn|error|debug)/);
            expect(c, rel(f)).not.toMatch(/setPluginData\([^)]*token/i);
            expect(c, rel(f)).not.toMatch(/setSharedPluginData/);
        }
        // the only storage used for settings is clientStorage
        expect(read("src/extract/figmaHost.ts")).toMatch(/clientStorage\.setAsync/);
    });
    it("manifest.json only allows api.github.com", () => {
        const m = JSON.parse(readFileSync("manifest.json", "utf8"));
        expect(m.networkAccess.allowedDomains).toEqual(["https://api.github.com"]);
    });
    it("no forbidden APIs: REST API, MCP, dev-mode usage", () => {
        for (const f of src)
            expect(read(f), rel(f)).not.toMatch(/api\.figma\.com|devResources|getDevResources|mcp/i);
    });
});
