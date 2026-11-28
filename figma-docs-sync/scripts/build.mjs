import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

// UI bundle -> inlined into ui.html (the Figma UI iframe has no file access).
const ui = await build({
  entryPoints: ["src/ui/ui.ts"],
  bundle: true,
  minify: false,
  write: false,
  format: "iife",
  target: "es2019",
  legalComments: "none",
});
const script = ui.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
// Fonts are inlined: the plugin may only reach api.github.com, so no Google Fonts at runtime (SIL OFL allows embedding).
const fontFaces = [
  ["IBM Plex Sans", "ibm-plex-sans"],
  ["Red Hat Mono", "red-hat-mono"],
]
  .flatMap(([family, pkg]) =>
    [400, 500, 600].map((w) => {
      const b64 = readFileSync(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`).toString("base64");
      return `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    }),
  )
  .join("\n");
const css = fontFaces + "\n" + readFileSync("src/ui/tokens.css", "utf8") + readFileSync("src/ui/ui.css", "utf8");
const html = readFileSync("src/ui/ui.html", "utf8")
  .replace("/*__STYLE__*/", () => css)
  .replace("/*__SCRIPT__*/", () => script);
writeFileSync("dist/ui.html", html);

// Main-thread bundle: extract + orchestration. `__html__` is injected by Figma from manifest "ui".
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/code.js",
  format: "iife",
  target: "es2017",
  legalComments: "none",
});
console.log("built dist/code.js and dist/ui.html");
