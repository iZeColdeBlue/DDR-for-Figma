// Plugin UI (runs in the iframe, which has `fetch`). Holds the network + sync side:
// GitHub client, diff, statuses, zip download. No Figma API access here.
import { zipSync } from "fflate";
import { DEFAULT_SETTINGS } from "../messages";
import { dirname, joinPath, normalizeFolder } from "../paths";
import { computeDiff, findPathCollisions } from "../sync/diff";
import { GitHubClient, BranchMovedError } from "../sync/github";
import { emptyManifest } from "../sync/manifest";
import { loadRemoteState, runSync } from "../sync/sync";
import { markdownToHtml } from "./preview";
const S = {
    tab: "docs",
    settings: { ...DEFAULT_SETTINGS },
    docs: [],
    built: [],
    remote: null,
    remoteError: "",
    diff: null,
    selection: null,
    busy: "", // progress text while busy
    notice: null,
    previewDocId: "",
    previewMode: "rendered",
    overwrite: new Set(),
    editingPath: new Set(),
    fileKeyKnown: false,
};
let pending = null;
const blobUrls = [];
const app = document.getElementById("app");
const send = (m) => parent.postMessage({ pluginMessage: m }, "*");
function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false)
            continue;
        if (k.startsWith("on"))
            el[k.toLowerCase()] = v;
        else if (k === "class")
            el.className = v;
        else if (k === "html")
            el.innerHTML = v;
        else if (k === "value")
            el.value = v;
        else
            el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids)
        if (k)
            el.append(k);
    return el;
}
// ---------- modal (window.confirm is unavailable in plugin iframes) ----------
function modal(title, body, buttons) {
    return new Promise((resolve) => {
        const done = (v) => {
            overlay.remove();
            resolve(v);
        };
        const overlay = h("div", { class: "overlay" }, h("div", { class: "modal" }, h("h3", {}, title), typeof body === "string" ? h("div", { html: body }) : body, h("div", { class: "row" }, ...buttons.map((b) => h("button", { class: "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""), onclick: () => done(b.value) }, b.label)))));
        document.body.append(overlay);
    });
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileList = (paths) => h("ul", { class: "files" }, ...paths.map((p) => h("li", {}, p)));
// ---------- state helpers ----------
const settingsComplete = () => !!(S.settings.owner && S.settings.repo && S.settings.branch && S.settings.token);
const client = () => new GitHubClient({ owner: S.settings.owner.trim(), repo: S.settings.repo.trim(), branch: S.settings.branch.trim(), token: S.settings.token.trim() });
const docsFolder = () => normalizeFolder(S.settings.docsFolder);
const hasDuplicates = () => S.docs.some((d) => d.duplicate);
function desired() {
    return S.built.map((b) => {
        const files = {};
        const bytes = {};
        for (const f of b.files) {
            files[f.path] = f.sha;
            bytes[f.path] = f.bytes;
        }
        return { docId: b.docId, path: b.path, nodeId: b.nodeId, files, bytes };
    });
}
function errMsg(e) {
    if (e instanceof BranchMovedError)
        return "The branch kept changing on GitHub. Please try syncing again.";
    return e instanceof Error ? e.message : String(e);
}
function recomputeDiff() {
    S.diff = null;
    if (!S.built.length && !S.remote)
        return;
    try {
        S.diff = computeDiff({
            docs: desired(),
            manifest: S.remote?.manifest ?? emptyManifest(),
            remote: S.remote?.remote ?? {},
            overwrite: S.overwrite,
            confirmDeletes: false,
        });
    }
    catch (e) {
        S.diff = null;
        S.notice = { kind: "err", html: esc(errMsg(e)) };
    }
}
const statusOf = (docId) => S.diff?.docs.find((d) => d.docId === docId)?.status;
async function fetchRemote() {
    S.remote = null;
    S.remoteError = "";
    if (!settingsComplete())
        return;
    try {
        S.remote = await loadRemoteState(client(), docsFolder());
    }
    catch (e) {
        S.remoteError = errMsg(e);
    }
}
// ---------- flows ----------
function startBuild(why) {
    if (S.busy)
        return;
    pending = why;
    S.busy = why === "status" ? "Converting Docs…" : why === "sync" ? "Converting Docs…" : "Preparing zip…";
    S.notice = why === "status" ? S.notice : null;
    render();
    send({ type: "build" });
}
async function onBuilt(docs) {
    S.built = docs;
    const why = pending;
    pending = null;
    try {
        if (why === "zip")
            return await downloadZip();
        if (why === "sync")
            return await doSync();
        S.busy = "Checking GitHub…";
        render();
        await fetchRemote();
        recomputeDiff();
    }
    finally {
        S.busy = "";
        render();
    }
}
async function doSync() {
    const docs = desired();
    const collisions = findPathCollisions(docs);
    if (collisions.length)
        throw new Error(collisions.join(" "));
    const progress = (t) => {
        S.busy = t;
        render();
    };
    const c = client();
    try {
        let outcome = await runSync({ client: c, docsFolder: docsFolder(), docs, overwrite: S.overwrite, deletes: "ask", onProgress: progress });
        if (outcome.kind === "needs-confirmation") {
            const files = outcome.diff.pendingDeletes.map((d) => d.path);
            const choice = await modal("Delete files from the repo?", h("div", {}, h("div", {}, "These generated files are no longer produced by Figma (removed image or deleted frame):"), fileList(files)), [
                { label: "Cancel sync", value: "cancel" },
                { label: "Keep them, sync the rest", value: "no" },
                { label: `Delete ${files.length} file${files.length === 1 ? "" : "s"}`, value: "yes", primary: true, danger: true },
            ]);
            if (choice === "cancel") {
                S.notice = { kind: "warn", html: "Sync cancelled. Nothing was changed." };
                await fetchRemote();
                recomputeDiff();
                return;
            }
            outcome = await runSync({ client: c, docsFolder: docsFolder(), docs, overwrite: S.overwrite, deletes: choice, onProgress: progress });
        }
        if (outcome.kind === "committed") {
            const link = `<a href="${esc(outcome.commit.url)}" target="_blank" rel="noreferrer">${esc(outcome.commit.sha.slice(0, 7))}</a>`;
            S.notice = { kind: "ok", html: `Synced: ${esc(outcome.message)}. Commit ${link}.` };
            S.overwrite.clear();
        }
        else if (outcome.kind === "up-to-date") {
            const conflicts = outcome.diff.docs.filter((d) => d.status === "conflict").length;
            S.notice = conflicts
                ? { kind: "warn", html: `Nothing else to sync. ${conflicts} Doc(s) have conflicts and were skipped.` }
                : { kind: "ok", html: "Everything up to date. No commit was made." };
        }
        const skipped = outcome.diff.docs.filter((d) => d.status === "conflict").length;
        if (outcome.kind === "committed" && skipped)
            S.notice.html += ` ${skipped} Doc(s) with conflicts were skipped.`;
    }
    catch (e) {
        S.notice = { kind: "err", html: esc(errMsg(e)) };
    }
    progress("Refreshing status…");
    await fetchRemote();
    recomputeDiff();
}
async function downloadZip() {
    const entries = {};
    for (const b of S.built)
        for (const f of b.files)
            entries[f.path] = f.bytes;
    if (!Object.keys(entries).length)
        throw new Error("No Docs to export. Mark a frame as a Doc first.");
    const zip = zipSync(entries, { level: 6 });
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    blobUrls.push(url);
    const a = h("a", { href: url, download: "figma-docs.zip" });
    document.body.append(a);
    a.click();
    a.remove();
    S.notice = { kind: "ok", html: `Downloaded figma-docs.zip (${Object.keys(entries).length} files).` };
}
function trySync() {
    if (!settingsComplete()) {
        S.tab = "settings";
        S.notice = { kind: "warn", html: "Fill in the GitHub settings first." };
        return render();
    }
    if (hasDuplicates()) {
        S.notice = { kind: "err", html: "Some frames look duplicated (same Doc ID). Assign them new IDs before syncing." };
        return render();
    }
    startBuild("sync");
}
// ---------- rendering ----------
function render() {
    document.getElementById("tab-docs").className = S.tab === "docs" ? "on" : "";
    document.getElementById("tab-settings").className = S.tab === "settings" ? "on" : "";
    const focused = document.activeElement;
    const focusId = focused && focused.id ? focused.id : "";
    const sel = focused && focused.id ? [focused.selectionStart, focused.selectionEnd] : null;
    app.replaceChildren(S.tab === "docs" ? renderDocs() : renderSettings());
    if (focusId) {
        const el = document.getElementById(focusId);
        if (el) {
            el.focus();
            if (sel && sel[0] !== null && el.setSelectionRange)
                try {
                    el.setSelectionRange(sel[0], sel[1]);
                }
                catch { /* ignore */ }
        }
    }
}
function noticeEl() {
    return S.notice ? h("div", { class: "banner " + S.notice.kind, html: S.notice.html }) : null;
}
function renderDocs() {
    const root = h("div");
    root.append(noticeEl() ?? "");
    if (S.remoteError)
        root.append(h("div", { class: "banner err" }, "GitHub: " + S.remoteError));
    else if (!settingsComplete())
        root.append(h("div", { class: "banner" }, "Not connected to GitHub yet. Statuses assume nothing is synced. Add your repo in Settings."));
    const sel = S.selection;
    root.append(h("div", { class: "row" }, h("button", { class: "btn primary", disabled: !sel || !sel.markable || !!S.busy, onclick: () => send({ type: "mark" }), title: "Select a frame in Figma first" }, "Mark as Doc"), h("span", { class: "muted grow" }, sel ? (sel.docId ? `“${sel.name}” is a Doc` : sel.markable ? `Selected: ${sel.name}` : `Can’t mark a ${sel.type.toLowerCase()}`) : "Select a frame to mark it")));
    if (S.busy)
        root.append(h("div", { class: "banner spinner" }, S.busy));
    root.append(h("h3", {}, `Docs (${S.docs.length})`));
    if (!S.docs.length)
        root.append(h("div", { class: "muted" }, "No Docs yet. Select a frame and click “Mark as Doc”."));
    for (const d of S.docs)
        root.append(docCard(d));
    const orphans = S.diff?.orphans ?? [];
    for (const o of orphans) {
        if (!o.removed.length && !o.conflicts.length)
            continue;
        root.append(h("div", { class: "card" }, h("div", { class: "name" }, o.path), h("div", { class: "muted" }, "Frame no longer exists in this file."), o.removed.length ? h("div", {}, `${o.removed.length} file(s) will be deleted on the next sync (after confirmation).`) : null, o.conflicts.length ? h("div", { class: "banner err" }, `${o.conflicts.length} file(s) were edited in GitHub and will be kept.`) : null));
    }
    const changed = S.diff?.docs.filter((d) => d.status === "new" || d.status === "changed").length ?? 0;
    root.append(h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn primary", disabled: !!S.busy || !S.docs.length, onclick: trySync }, changed ? `Sync ${changed} Doc${changed === 1 ? "" : "s"}` : "Sync"), h("button", { class: "btn", disabled: !!S.busy || !S.docs.length, onclick: () => startBuild("zip") }, "Download .zip"), h("button", { class: "btn", disabled: !!S.busy, onclick: () => ((S.notice = null), send({ type: "listDocs" }), startBuild("status")) }, "Refresh")));
    const pv = S.docs.find((d) => d.docId === S.previewDocId);
    if (pv)
        root.append(previewEl(pv));
    return root;
}
function docCard(d) {
    const status = statusOf(d.docId);
    const locked = !!S.remote?.manifest.docs[d.docId] && !S.editingPath.has(d.docId);
    const built = S.built.find((b) => b.docId === d.docId);
    const card = h("div", { class: "card" + (S.previewDocId === d.docId ? " sel" : "") });
    card.append(h("div", { class: "row" }, h("span", { class: "name grow", title: "Show in Figma", style: "cursor:pointer", onclick: () => send({ type: "focus", docId: d.docId }) }, d.name), status ? h("span", { class: "chip " + status }, status) : h("span", { class: "chip muted" }, S.busy ? "…" : "?")));
    if (d.duplicate) {
        card.append(h("div", { class: "banner warn" }, "This frame has the same Doc ID as another frame (probably a duplicate). ", h("button", { class: "btn", onclick: () => send({ type: "reId", docId: d.docId }) }, "Assign new ID")));
    }
    if (locked) {
        card.append(h("div", { class: "row" }, h("span", { class: "muted grow" }, joinPath(docsFolder(), d.relPath)), h("button", { class: "btn", onclick: () => (S.editingPath.add(d.docId), render()) }, "Change path")));
    }
    else {
        card.append(h("div", { class: "row" }, h("span", { class: "muted" }, docsFolder() ? docsFolder() + "/" : ""), h("input", {
            type: "text",
            id: "path-" + d.docId,
            class: "grow",
            value: d.relPath,
            onchange: (e) => {
                S.editingPath.delete(d.docId);
                send({ type: "setPath", docId: d.docId, relPath: e.target.value });
            },
        })));
    }
    for (const w of built?.warnings ?? [])
        card.append(h("div", { class: "hint" }, "⚠ " + w));
    const dd = S.diff?.docs.find((x) => x.docId === d.docId);
    if (dd && dd.status === "conflict") {
        const will = S.overwrite.has(d.docId);
        card.append(h("div", { class: "banner err" }, "Edited in GitHub since the last sync; skipped to protect those edits:", fileList(dd.conflicts), h("button", { class: "btn" + (will ? "" : " danger"), onclick: () => confirmOverwrite(d, dd.conflicts) }, will ? "Will overwrite (undo)" : "Overwrite…")));
    }
    else if (dd && (dd.added.length || dd.updated.length || dd.removed.length)) {
        card.append(h("div", { class: "hint" }, `${dd.added.length} added · ${dd.updated.length} updated · ${dd.removed.length} to remove`));
    }
    card.append(h("div", { class: "row" }, h("button", { class: "btn", onclick: () => ((S.previewDocId = S.previewDocId === d.docId ? "" : d.docId), render()) }, S.previewDocId === d.docId ? "Hide preview" : "Preview")));
    return card;
}
async function confirmOverwrite(d, files) {
    if (S.overwrite.has(d.docId)) {
        S.overwrite.delete(d.docId);
    }
    else {
        const v = await modal("Overwrite GitHub edits?", h("div", {}, h("div", {}, `Someone changed generated files in GitHub. On the next sync, Figma’s version of “${d.name}” will replace them:`), fileList(files)), [
            { label: "Cancel", value: "no" },
            { label: "Overwrite on next sync", value: "yes", primary: true, danger: true },
        ]);
        if (v === "yes")
            S.overwrite.add(d.docId);
    }
    recomputeDiff();
    render();
}
function previewEl(d) {
    const built = S.built.find((b) => b.docId === d.docId);
    const box = h("div", { class: "preview" });
    if (!built) {
        box.append(h("div", { class: "muted" }, S.busy ? "Converting…" : "Click Refresh to convert."));
        return box;
    }
    box.append(h("div", { class: "row tabs" }, h("button", { class: "btn" + (S.previewMode === "rendered" ? " primary" : ""), onclick: () => ((S.previewMode = "rendered"), render()) }, "Rendered"), h("button", { class: "btn" + (S.previewMode === "source" ? " primary" : ""), onclick: () => ((S.previewMode = "source"), render()) }, "Markdown")));
    if (S.previewMode === "source") {
        box.append(h("pre", {}, built.markdown));
    }
    else {
        const byPath = new Map(built.files.map((f) => [f.path, f.bytes]));
        const html = markdownToHtml(built.markdown, (rel) => {
            const full = normalizePosix(joinPath(dirname(built.path), rel));
            const bytes = byPath.get(full);
            if (!bytes)
                return undefined;
            const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
            blobUrls.push(url);
            return url;
        });
        box.append(h("div", { html }));
    }
    return box;
}
function normalizePosix(p) {
    const out = [];
    for (const s of p.split("/")) {
        if (s === "..")
            out.pop();
        else if (s && s !== ".")
            out.push(s);
    }
    return out.join("/");
}
function renderSettings() {
    const root = h("div");
    root.append(noticeEl() ?? "");
    const field = (id, label, hint = "", type = "text") => h("div", {}, h("label", { for: "s-" + id }, label), h("input", { type, id: "s-" + id, value: S.settings[id], autocomplete: "off", spellcheck: "false", oninput: (e) => ((S.settings[id] = e.target.value), void 0) }), hint ? h("div", { class: "hint" }, hint) : null);
    root.append(field("owner", "GitHub owner", "User or organisation, e.g. my-org"), field("repo", "Repository", "e.g. design-docs"), field("branch", "Branch", "Commits go straight to this branch."), field("docsFolder", "Docs folder", "Default: docs. Generated files and the manifest live here."), field("token", "Fine-grained personal access token", "Repository access: only this repo. Permission: Contents → Read and write. Stored on this machine only (Figma clientStorage), never in the file.", "password"), field("figmaFileUrl", "Figma file URL (optional)", "Used for the link in each .md. Only needed if the plugin can’t read the file key itself."));
    root.append(h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn primary", onclick: saveSettings }, "Save & test connection")));
    if (S.docs.length && !S.fileKeyKnown && !S.settings.figmaFileUrl)
        root.append(h("div", { class: "hint" }, "No file key available: the Figma link will be left out of the Markdown front matter."));
    return root;
}
async function saveSettings() {
    const s = S.settings;
    s.owner = s.owner.trim();
    s.repo = s.repo.trim();
    s.branch = s.branch.trim() || "main";
    s.docsFolder = normalizeFolder(s.docsFolder);
    s.token = s.token.trim();
    send({ type: "saveSettings", settings: { ...s } });
    if (!settingsComplete()) {
        S.notice = { kind: "warn", html: "Saved. Owner, repo, branch and token are all needed to sync." };
        return render();
    }
    S.busy = "Testing connection…";
    render();
    await fetchRemote();
    S.busy = "";
    S.notice = S.remoteError ? { kind: "err", html: esc(S.remoteError) } : { kind: "ok", html: "Connected. Settings saved." };
    render();
    if (!S.remoteError) {
        S.tab = "docs";
        startBuild("status");
    }
}
// ---------- wiring ----------
document.getElementById("tab-docs").onclick = () => ((S.tab = "docs"), render());
document.getElementById("tab-settings").onclick = () => ((S.tab = "settings"), render());
let initialDocs = true;
window.onmessage = (ev) => {
    const m = ev.data?.pluginMessage;
    if (!m)
        return;
    switch (m.type) {
        case "settings":
            S.settings = { ...DEFAULT_SETTINGS, ...m.settings };
            return render();
        case "docs": {
            S.docs = m.docs;
            S.fileKeyKnown = !!m.fileKey;
            if (initialDocs) {
                initialDocs = false;
                startBuild("status");
            }
            else if (!S.busy) {
                const sig = (xs) => xs.map((x) => x.docId + "|" + x.relPath).sort().join(",");
                if (sig(S.docs.filter((d) => !d.duplicate)) !== sig(S.built))
                    startBuild("status");
                else
                    recomputeDiff();
            }
            return render();
        }
        case "selection":
            S.selection = m.selection;
            return render();
        case "progress":
            S.busy = m.text;
            return render();
        case "built":
            void onBuilt(m.docs);
            return;
        case "error":
            S.busy = "";
            pending = null;
            S.notice = { kind: "err", html: esc(m.message) };
            return render();
    }
};
render();
send({ type: "init" });
