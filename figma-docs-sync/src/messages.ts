// Message protocol between the plugin main thread (extract) and the UI iframe (network + sync).
// No Figma dependency.

export type Settings = {
  owner: string;
  repo: string;
  branch: string;
  docsFolder: string;
  /** fine-grained PAT; lives only in figma.clientStorage (and in UI memory while the plugin is open) */
  token: string;
  /** optional: figma file URL, used to derive fileKey when figma.fileKey is unavailable */
  figmaFileUrl: string;
};

export const DEFAULT_SETTINGS: Settings = {
  owner: "",
  repo: "",
  branch: "main",
  docsFolder: "docs",
  token: "",
  figmaFileUrl: "",
};

export type DocInfo = {
  docId: string;
  nodeId: string;
  name: string;
  page: string;
  /** path relative to the docs folder */
  relPath: string;
  /** another frame with the same docId exists and this one looks like the copy */
  duplicate: boolean;
};

export type SelectionInfo = {
  nodeId: string;
  name: string;
  type: string;
  /** markable as a Doc (single FRAME/SECTION/COMPONENT, not already a Doc) */
  markable: boolean;
  docId?: string;
} | null;

export type BuiltPayload = {
  docId: string;
  title: string;
  relPath: string;
  path: string;
  nodeId: string;
  markdown: string;
  files: { path: string; bytes: Uint8Array; sha: string }[];
  warnings: string[];
};

export type UIToMain =
  | { type: "init" }
  | { type: "saveSettings"; settings: Settings }
  | { type: "listDocs" }
  | { type: "mark" }
  | { type: "setPath"; docId: string; relPath: string }
  | { type: "reId"; docId: string }
  | { type: "focus"; docId: string }
  | { type: "build" };

export type MainToUI =
  | { type: "settings"; settings: Settings }
  | { type: "docs"; docs: DocInfo[]; fileKey?: string }
  | { type: "selection"; selection: SelectionInfo }
  | { type: "built"; docs: BuiltPayload[] }
  | { type: "progress"; text: string }
  | { type: "error"; message: string };
