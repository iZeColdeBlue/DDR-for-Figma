// Neutral data model shared by all three layers (blueprint §4). No Figma types here.

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "image"; assetId: string; alt: string; nodeId: string };

export type DocModel = {
  docId: string; // stable UUID stored in plugin data on the frame
  title: string; // frame name
  path: string; // e.g. "docs/buttons.md"
  figma: { fileKey?: string; nodeId: string };
  blocks: Block[];
};

/** A file that will exist in the repo. `sha` is the git blob SHA of `bytes`. */
export type OutFile = { path: string; bytes: Uint8Array; sha: string };

export type AssetRef = { assetId: string; nodeId: string; path: string };

export type ManifestDoc = {
  path: string;
  nodeId: string;
  files: Record<string, string>; // repo path -> git blob sha
};

export type Manifest = {
  version: 1;
  docs: Record<string, ManifestDoc>;
};

export const MANIFEST_NAME = ".figma-docs.json";
