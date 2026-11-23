// Thin, JSON-serialisable node interface (blueprint §8). The Figma adapter
// (figmaHost.ts) snapshots real SceneNodes into this shape; tests build it by hand.

export interface TextSegmentLike {
  text: string;
  fontSize: number;
  fontFamily: string;
  /** e.g. "Bold", "Italic", "Regular" (Figma font style name) */
  fontStyle: string;
  fontWeight: number;
  list: "NONE" | "ORDERED" | "UNORDERED";
  indentation: number;
  href?: string;
  /** Name of the applied text style, if any (e.g. "Heading/H2"). */
  styleName?: string;
}

export interface NodeLike {
  id: string;
  name: string;
  /** Figma node type string: FRAME, GROUP, SECTION, TEXT, INSTANCE, RECTANGLE, … */
  type: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Auto-layout direction; absent/"NONE" means free-form. */
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  /** True if the node has any visible fill, stroke or effect. */
  hasVisiblePaint: boolean;
  children?: NodeLike[];
  segments?: TextSegmentLike[];
}
