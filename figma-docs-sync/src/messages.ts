// Message protocol between the plugin main thread (extract) and the UI iframe (network + sync).
// No Figma dependency.

/** Per Figma file, shared with everyone who opens it (figma.root plugin data). Never holds the token. */
export type FileConfig = {
  /** "" = nothing set up yet */
  mode: "" | "github" | "local";
  owner: string;
  repo: string;
  /** "" = the repo's default branch */
  branch: string;
  docsFolder: string;
};

export const DEFAULT_FILE_CONFIG: FileConfig = { mode: "", owner: "", repo: "", branch: "", docsFolder: "docs" };

/** Per user, this computer only (figma.clientStorage). */
export type UserConfig = {
  /** fine-grained PAT; one per user, shared across files */
  token: string;
  /** personal overrides for this file; "" = use the file value */
  branchOverride: string;
  folderOverride: string;
  /** screen 19 was dismissed for this file */
  noticeDismissed: boolean;
  /** the "Local mode" banner on Home was dismissed for this file */
  localBannerDismissed: boolean;
};

export const DEFAULT_USER_CONFIG: UserConfig = {
  token: "",
  branchOverride: "",
  folderOverride: "",
  noticeDismissed: false,
  localBannerDismissed: false,
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
  | { type: "saveFileConfig"; config: FileConfig }
  | { type: "saveUserConfig"; config: UserConfig }
  | { type: "listDocs" }
  | { type: "mark" }
  | { type: "reId"; docId: string }
  | { type: "focus"; docId: string }
  /** docsFolder: the effective folder (personal override or file value) */
  | { type: "build"; docsFolder: string };

export type MainToUI =
  /** fileId: stable per-file id (figma.fileKey is not available to public plugins) */
  | { type: "config"; file: FileConfig; user: UserConfig; fileId: string }
  | { type: "docs"; docs: DocInfo[]; fileKey?: string }
  | { type: "selection"; selection: SelectionInfo }
  | { type: "built"; docs: BuiltPayload[]; fileKey?: string }
  | { type: "progress"; text: string }
  /** `build`: the failed request was a conversion, so the UI should stop waiting for "built". */
  | { type: "error"; message: string; build?: boolean };
