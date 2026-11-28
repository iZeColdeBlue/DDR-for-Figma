// Drives dist/ui.html in headless Chromium. A stub plays the plugin main thread (using the real
// buildDoc over fake node trees); api.github.com is routed to the in-memory FakeGitHub.
// Usage: node scripts/ui-e2e.mjs <workdir for bundles+screenshots>
import { build } from "esbuild";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const work = process.argv[2];
mkdirSync(work, { recursive: true });
await build({ entryPoints: ["tests/e2e/lib.ts"], bundle: true, platform: "node", format: "esm", outfile: `${work}/lib.mjs`, logLevel: "error" });
const lib = await import(pathToFileURL(`${work}/lib.mjs`).href);
const { chromium } = createRequire(import.meta.url)("playwright");
const { unzipSync } = await import(pathToFileURL(process.cwd() + "/node_modules/fflate/esm/browser.js").href);

const { FakeGitHub, buildDoc, frame, resetIds, seg, shape, text, encodeBase64 } = lib;
resetIds();
const gh = new FakeGitHub();
const intro = text("Intro", [seg("Use buttons to trigger actions.")], { y: 50 });
const img = shape("Primary button", { type: "INSTANCE", y: 100 });
const docs = [
  { docId: "doc-buttons", name: "Buttons", relPath: "buttons.md", nodeId: "10:1", page: "Page 1", duplicate: false,
    snap: frame("Buttons", [text("T", [seg("Buttons", { fontSize: 32 })], { y: 0 }), intro, img], { id: "10:1" }) },
  { docId: "doc-voice", name: "Voice", relPath: "voice.md", nodeId: "20:1", page: "Page 1", duplicate: false,
    snap: frame("Voice", [text("T", [seg("Voice", { fontSize: 32 })], { y: 0 }), text("L", [seg("Be clear\nBe kind", { list: "UNORDERED" })], { y: 50 })], { id: "20:1" }) },
];
const png = async (id) => new TextEncoder().encode(`PNG[${id}]`.padEnd(64, "."));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
await page.route("https://api.github.com/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const res = await gh.fetch(req.url(), { method: req.method(), headers: { Authorization: req.headers()["authorization"] }, body: req.postData() ?? undefined });
  // FakeGitHub checks `Authorization` with that exact casing
  await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: await res.text() });
});

const settings = { owner: gh.owner, repo: gh.repo, branch: "main", docsFolder: "docs", token: gh.token, figmaFileUrl: "" };
const toUI = async (m) => page.evaluate((m) => document.querySelector("iframe").contentWindow.postMessage({ pluginMessage: m }, "*"), m);
await page.exposeFunction("__toMain", async (m) => {
  if (m.type === "init") {
    await toUI({ type: "settings", settings });
    await toUI({ type: "docs", docs: docs.map(({ snap, ...d }) => d), fileKey: "FILEKEY1234" });
    await toUI({ type: "selection", selection: { nodeId: "30:1", name: "New frame", type: "FRAME", markable: true } });
  } else if (m.type === "build") {
    const out = [];
    for (const d of docs) {
      const b = await buildDoc({ snapshot: d.snap, docId: d.docId, relPath: d.relPath, docsFolder: "docs", fileKey: "FILEKEY1234", exportPng: png });
      out.push({ docId: b.docId, title: b.title, relPath: b.relPath, path: b.path, nodeId: b.nodeId, markdown: b.markdown, warnings: b.warnings,
        files: b.files.map((f) => ({ path: f.path, sha: f.sha, b64: encodeBase64(f.bytes) })) });
    }
    await toUI({ type: "__built_b64", docs: out });
  }
});

const ui = readFileSync("dist/ui.html", "utf8");
await page.setContent(`<!doctype html><body style="margin:0"><iframe style="width:420px;height:700px;border:0"></iframe>
<script>
  const f = document.querySelector('iframe'); f.srcdoc = ${JSON.stringify(ui).replace(/</g, "\\u003c")};
  window.addEventListener('message', (e) => {
    if (e.source !== f.contentWindow || !e.data || !e.data.pluginMessage) return;
    window.__toMain(e.data.pluginMessage);
  });
  // translate base64 payloads into Uint8Array like postMessage from the real main thread would
  window.addEventListener('message', (e) => {});
  const orig = f; 
</script></body>`);
// base64 -> Uint8Array bridge (the stub can only send JSON through exposeFunction)
await page.evaluate(() => {
  const f = document.querySelector("iframe");
  const origPost = f.contentWindow.postMessage.bind(f.contentWindow);
  f.contentWindow.postMessage = (m, t) => {
    if (m && m.pluginMessage && m.pluginMessage.type === "__built_b64") {
      const docs = m.pluginMessage.docs.map((d) => ({ ...d, files: d.files.map((x) => ({ path: x.path, sha: x.sha, bytes: Uint8Array.from(atob(x.b64), (c) => c.charCodeAt(0)) })) }));
      return origPost({ pluginMessage: { type: "built", docs } }, t);
    }
    return origPost(m, t);
  };
});

const ifr = page.frameLocator("iframe");
const shot = (n) => page.screenshot({ path: `${work}/shots/${n}.png` });
const chip = (id) => ifr.locator(".card", { hasText: id }).locator(".chip").first();

await ifr.locator(".card").first().waitFor();
await chip("Buttons").waitFor();
await page.waitForFunction(() => document.querySelector("iframe").contentDocument.body.innerText.includes("new"), null, { timeout: 15000 });
await shot("1-initial");
assert.equal((await ifr.locator(".chip.new").count()), 2, "both docs start as 'new'");

// Preview
await ifr.getByRole("button", { name: "Preview" }).first().click();
await ifr.locator(".preview img").first().waitFor();
await shot("2-preview");
assert.ok((await ifr.locator(".preview h1").innerText()).includes("Buttons"));

// Sync
await ifr.getByRole("button", { name: /^Sync/ }).click();
await ifr.locator(".banner.ok, .banner.err", { hasText: /Synced|rror|GitHub|not/ }).first().waitFor({ timeout: 15000 }).catch(async () => { await shot("3-timeout"); console.log(await ifr.locator("main").innerText()); throw new Error("sync did not finish"); });
await shot("3-synced");
assert.ok(!(await ifr.locator(".banner.err").count()), await ifr.locator(".banner.err").allInnerTexts().then(String));
assert.equal(gh.commitCount(), 2, "exactly one commit made");
assert.equal(gh.commits.get(gh.head).message, "docs: sync from Figma (0 updated, 3 added, 0 removed)");
assert.deepEqual(gh.changedPaths(), ["docs/.figma-docs.json", "docs/assets/buttons/1-102.png".replace("1-102", img.id.replace(":", "-")), "docs/buttons.md", "docs/voice.md"].sort());
await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelectorAll(".chip").length >= 2 && [...document.querySelector("iframe").contentDocument.querySelectorAll(".chip")].every((c) => c.textContent === "up to date"));

// Sync again: no commit
await ifr.getByRole("button", { name: /^Sync/ }).click();
await ifr.locator(".banner.ok", { hasText: "Everything up to date" }).waitFor({ timeout: 15000 });
assert.equal(gh.commitCount(), 2, "no commit when nothing changed");

// Conflict
gh.userEdit("docs/voice.md", "# edited on GitHub\n");
await ifr.getByRole("button", { name: "Refresh" }).click();
await ifr.locator(".chip.conflict").waitFor({ timeout: 15000 });
await shot("4-conflict");
await ifr.getByRole("button", { name: /^Sync/ }).click();
await ifr.locator(".banner.warn, .banner.ok").first().waitFor();
assert.equal(gh.text("docs/voice.md"), "# edited on GitHub\n", "conflicting file not overwritten");
await page.waitForTimeout(500);

// Overwrite flow (in-page modal, not window.confirm)
await ifr.getByRole("button", { name: "Overwrite…" }).click();
await shot("5-overwrite-modal");
await ifr.getByRole("button", { name: "Overwrite on next sync" }).click();
await ifr.getByRole("button", { name: /^Sync/ }).click();
await ifr.locator(".banner.ok", { hasText: "Synced" }).waitFor({ timeout: 15000 });
assert.ok(gh.text("docs/voice.md").includes("Be clear"), "overwritten after explicit confirmation");

// Delete confirmation: remove the image
docs[0].snap.children = docs[0].snap.children.filter((c) => c !== img);
await ifr.getByRole("button", { name: "Refresh" }).click();
await ifr.locator(".chip.changed").waitFor({ timeout: 15000 });
await ifr.getByRole("button", { name: /^Sync/ }).click();
await ifr.locator(".modal").waitFor({ timeout: 15000 });
await shot("6-delete-modal");
assert.ok((await ifr.locator(".modal").innerText()).includes("assets/buttons/"));
const png1 = `docs/assets/buttons/${img.id.replace(":", "-")}.png`;
assert.ok(gh.files()[png1], "png still there before confirming");
await ifr.getByRole("button", { name: /^Delete 1 file/ }).click();
await ifr.locator(".banner.ok", { hasText: "Synced" }).waitFor({ timeout: 15000 });
assert.equal(gh.files()[png1], undefined, "png removed after confirmation");

// Zip
const [dl] = await Promise.all([page.waitForEvent("download"), ifr.getByRole("button", { name: "Download .zip" }).click()]);
const zipPath = `${work}/out.zip`;
await dl.saveAs(zipPath);
const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(zipPath))));
assert.deepEqual(entries.sort(), ["docs/buttons.md", "docs/voice.md"]);

// Settings screen never echoes the token as text
await ifr.locator("#tab-settings").click();
await shot("7-settings");
assert.ok(!(await ifr.locator("main").innerText()).includes(gh.token));

assert.deepEqual(errors, [], "no console/page errors");
await browser.close();
console.log("UI e2e OK");
