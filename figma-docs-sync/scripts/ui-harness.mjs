// Serves dist/ui.html in a page that plays Figma: a stub main thread (real buildDoc over fake node
// trees, config kept in localStorage so a reload = reopening the file) and api.github.com routed to
// the in-memory FakeGitHub. Open http://localhost:4173 and click through the flow.
// Usage: npm run build && node scripts/ui-harness.mjs [port]
// URL params: ?reset (fresh file), ?as=teammate (new user, same file). Fake token: ghp_TESTTOKEN_not_real
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const port = Number(process.argv[2] ?? 4173);
const out = ".e2e-out";
mkdirSync(out, { recursive: true });
await build({ entryPoints: ["tests/e2e/lib.ts"], bundle: true, platform: "node", format: "esm", outfile: `${out}/lib.mjs`, logLevel: "error" });
await build({ entryPoints: ["tests/e2e/browser.ts"], bundle: true, platform: "browser", format: "iife", globalName: "H", outfile: `${out}/browser.js`, logLevel: "error" });
const { FakeGitHub } = await import(pathToFileURL(`${process.cwd()}/${out}/lib.mjs`).href);
let gh = new FakeGitHub();
const expires = new Date(Date.now() + 90 * 86400000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

const page = () => {
  const ui = readFileSync("dist/ui.html", "utf8").replace(
    "<head>",
    `<head><script>const F = window.fetch; window.fetch = (u, i) => F(String(u).replace("https://api.github.com", "http://localhost:${port}/gh"), i);</script>`,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>UI harness</title></head>
<body style="margin:0;background:#333;display:flex;gap:16px;padding:16px;font:12px system-ui;color:#eee">
<iframe id="f" style="width:468px;height:760px;border:0;flex:none"></iframe>
<div style="display:flex;flex-direction:column;gap:6px;width:220px">
  <b>Harness</b>
  <a style="color:#9cf" href="/?reset">Fresh file</a>
  <a style="color:#9cf" href="/">Reopen (same user)</a>
  <a style="color:#9cf" href="/?as=teammate">Reopen as teammate</a>
  <button onclick="sel(true)">Select a frame</button>
  <button onclick="sel(false)">Clear selection</button>
  <button onclick="fetch('/edit').then(()=>alert('voice.md edited on GitHub'))">Edit a file on GitHub</button>
  <button onclick="delDoc()">Delete first frame</button>
  <pre id="log" style="white-space:pre-wrap;font-size:11px"></pre>
</div>
<script src="/browser.js"></script>
<script>
const qs = new URLSearchParams(location.search);
if (qs.has("reset")) { localStorage.clear(); fetch("/reset"); }
const user = qs.get("as") || "me";
const fileKey = "fds-harness:file", userKey = "fds-harness:" + user;
const load = (k, d) => JSON.parse(localStorage.getItem(k) || "null") || d;
const { buildDoc, frame, seg, shape, text, resetIds } = H;
resetIds();
let docs = [
  { docId: "doc-buttons", name: "Payment form", page: "Checkout", relPath: "checkout-payment-form.md", nodeId: "10:1", duplicate: false,
    snap: frame("Payment form", [text("T", [seg("Payment form", { fontSize: 32 })], { y: 0 }), text("I", [seg("Use buttons to pay.")], { y: 50 }), shape("Pay button", { type: "INSTANCE", y: 100 })], { id: "10:1" }) },
  { docId: "doc-voice", name: "Flow", page: "Onboarding", relPath: "onboarding-flow.md", nodeId: "20:1", duplicate: false,
    snap: frame("Flow", [text("T", [seg("Flow", { fontSize: 32 })], { y: 0 }), text("L", [seg("Be clear\\nBe kind", { list: "UNORDERED" })], { y: 50 })], { id: "20:1" }) },
];
let selection = null;
const f = document.getElementById("f");
const log = (m) => (document.getElementById("log").textContent = JSON.stringify(m, (k, v) => (k === "token" && v ? "***" : v)).slice(0, 300) + "\\n" + document.getElementById("log").textContent.slice(0, 2000));
const toUI = (m) => f.contentWindow.postMessage({ pluginMessage: m }, "*");
const pub = () => docs.map(({ snap, ...d }) => d);
window.sel = (on) => { selection = on ? { nodeId: "30:1", name: "New frame", type: "FRAME", markable: true } : null; toUI({ type: "selection", selection }); };
window.delDoc = () => { docs.shift(); toUI({ type: "docs", docs: pub() }); };
window.addEventListener("message", async (e) => {
  const m = e.source === f.contentWindow && e.data && e.data.pluginMessage;
  if (!m) return;
  log(m);
  if (m.type === "init") {
    const file = load(fileKey, { mode: "", owner: "", repo: "", branch: "", docsFolder: "docs" });
    const u = load(userKey, {});
    toUI({ type: "config", fileId: localStorage.getItem("fds-harness:fileId") || (localStorage.setItem("fds-harness:fileId", "file-" + Math.random().toString(36).slice(2)), localStorage.getItem("fds-harness:fileId")), file, user: { token: load("fds-harness:token:" + user, ""), branchOverride: "", folderOverride: "", noticeDismissed: false, localBannerDismissed: false, ...u } });
    toUI({ type: "docs", docs: pub(), fileKey: "FILEKEY1234" });
    toUI({ type: "selection", selection });
  } else if (m.type === "saveFileConfig") localStorage.setItem(fileKey, JSON.stringify(m.config));
  else if (m.type === "saveUserConfig") {
    const { token, ...rest } = m.config;
    localStorage.setItem("fds-harness:token:" + user, JSON.stringify(token));
    localStorage.setItem(userKey, JSON.stringify(rest));
  } else if (m.type === "listDocs") toUI({ type: "docs", docs: pub(), fileKey: "FILEKEY1234" });
  else if (m.type === "mark" && selection) {
    docs.push({ docId: "doc-new", name: "New frame", page: "Page 1", relPath: "new-frame.md", nodeId: "30:1", duplicate: false,
      snap: frame("New frame", [text("T", [seg("New frame", { fontSize: 32 })], { y: 0 })], { id: "30:1" }) });
    selection = { ...selection, markable: false, docId: "doc-new" };
    toUI({ type: "docs", docs: pub() }); toUI({ type: "selection", selection });
  } else if (m.type === "build") {
    const out = [];
    for (const d of docs) out.push(await buildDoc({ snapshot: d.snap, docId: d.docId, relPath: d.relPath, docsFolder: m.docsFolder, fileKey: "FILEKEY1234", exportPng: async (id) => new TextEncoder().encode(("PNG[" + id + "]").padEnd(64, ".")) }));
    toUI({ type: "built", docs: out, fileKey: "FILEKEY1234" });
  }
});
f.srcdoc = ${JSON.stringify(ui).replace(/</g, "\\u003c")};
</script></body></html>`;
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(page());
  if (url.pathname === "/browser.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(readFileSync(`${out}/browser.js`));
  if (url.pathname === "/reset") return (gh = new FakeGitHub()), res.end("ok");
  if (url.pathname === "/edit") {
    const p = Object.keys(gh.files()).find((k) => k.endsWith("onboarding-flow.md"));
    if (p) gh.userEdit(p, "# edited on GitHub\n");
    return res.end(p ? "ok" : "nothing synced yet");
  }
  if (url.pathname.startsWith("/gh/")) {
    let body = "";
    for await (const c of req) body += c;
    const r = await gh.fetch("https://api.github.com" + url.pathname.slice(3) + url.search, {
      method: req.method,
      headers: { Authorization: req.headers["authorization"] },
      body: body || undefined,
    });
    const headers = { "content-type": "application/json", "github-authentication-token-expiration": expires };
    for (const k of ["x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"]) if (r.headers.get(k)) headers[k] = r.headers.get(k);
    return res.writeHead(r.status, headers).end(await r.text());
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`UI harness on http://localhost:${port}`));
