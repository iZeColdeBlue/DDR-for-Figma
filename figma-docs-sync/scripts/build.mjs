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
const html = readFileSync("src/ui/ui.html", "utf8").replace("/*__SCRIPT__*/", () => script);
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
