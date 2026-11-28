// Plugin main thread: orchestration only. All Figma access goes through `host` (src/extract/figmaHost.ts).
import { host } from "./extract/figmaHost";
import { buildDoc } from "./build";
import { normalizeFolder } from "./paths";
import type { BuiltPayload, DocInfo, UIToMain } from "./messages";

declare const __html__: string;

host.showUI(__html__);

let docs: DocInfo[] = [];
let busy = false;

async function refreshDocs(): Promise<void> {
  docs = await host.listDocs();
  host.post({ type: "docs", docs, fileKey: host.fileKey() });
}

function postSelection(): void {
  host.post({ type: "selection", selection: host.selection() });
}

host.onSelectionChange(postSelection);

async function buildAll(folder: string): Promise<{ docs: BuiltPayload[]; fileKey?: string }> {
  const docsFolder = normalizeFolder(folder);
  const fileKey = host.fileKey();
  await refreshDocs();
  const out: BuiltPayload[] = [];
  const active = docs.filter((d) => !d.duplicate);
  let i = 0;
  for (const d of active) {
    host.post({ type: "progress", text: `Converting ${++i}/${active.length}: ${d.name}` });
    const snapshot = await host.snapshot(d.nodeId);
    const built = await buildDoc({
      snapshot,
      docId: d.docId,
      relPath: d.relPath,
      docsFolder,
      fileKey,
      exportPng: (id) => host.exportPng(id),
    });
    out.push(built);
  }
  return { docs: out, fileKey };
}

async function handle(m: UIToMain): Promise<void> {
  switch (m.type) {
    case "init": {
      // Config first, so the first screen shows without waiting for every page to load (listDocs).
      host.post({ type: "config", ...(await host.loadConfig()) });
      await refreshDocs();
      postSelection();
      if (docs.length && (await host.migrateLegacyFile())) host.post({ type: "config", ...(await host.loadConfig()) });
      return;
    }
    case "saveFileConfig":
      host.saveFileConfig(m.config);
      return;
    case "saveUserConfig":
      await host.saveUserConfig(m.config);
      return;
    case "listDocs":
      await refreshDocs();
      postSelection();
      return;
    case "mark": {
      await refreshDocs();
      await host.markSelection(docs.map((d) => d.relPath));
      await refreshDocs();
      postSelection();
      return;
    }
    case "reId": {
      const d = docs.find((x) => x.docId === m.docId && x.duplicate);
      if (!d) throw new Error("That frame is no longer a duplicate.");
      await host.reId(d.nodeId, docs.map((x) => x.relPath));
      await refreshDocs();
      return;
    }
    case "focus":
      await host.focus(m.docId);
      return;
    case "build": {
      host.post({ type: "built", ...(await buildAll(m.docsFolder)) });
      return;
    }
  }
}

host.onMessage((m) => {
  if (busy && m.type === "build") {
    host.post({ type: "error", message: "A conversion is already running." });
    return;
  }
  const isBuild = m.type === "build";
  if (isBuild) busy = true;
  handle(m)
    .catch((e: unknown) => host.post({ type: "error", message: e instanceof Error ? e.message : String(e), build: isBuild }))
    .finally(() => {
      if (isBuild) busy = false;
    });
});
