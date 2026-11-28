import type { NodeLike, TextSegmentLike } from "../../src/extract/nodeLike";

let n = 100;
export const resetIds = () => (n = 100);

export const seg = (text: string, o: Partial<TextSegmentLike> = {}): TextSegmentLike => ({
  text,
  fontSize: 16,
  fontFamily: "Inter",
  fontStyle: "Regular",
  fontWeight: 400,
  list: "NONE",
  indentation: 0,
  ...o,
});

type Pos = { x?: number; y?: number; w?: number; h?: number };
const geo = (p: Pos) => ({ x: p.x ?? 0, y: p.y ?? 0, width: p.w ?? 100, height: p.h ?? 20 });

export const text = (name: string, segments: TextSegmentLike[], p: Pos & { visible?: boolean } = {}): NodeLike => ({
  id: `1:${++n}`,
  name,
  type: "TEXT",
  visible: p.visible ?? true,
  hasVisiblePaint: true,
  segments,
  ...geo(p),
});

export const shape = (name: string, p: Pos & { type?: string; visible?: boolean } = {}): NodeLike => ({
  id: `1:${++n}`,
  name,
  type: p.type ?? "RECTANGLE",
  visible: p.visible ?? true,
  hasVisiblePaint: true,
  ...geo({ h: 40, ...p }),
});

export const frame = (
  name: string,
  children: NodeLike[],
  p: Pos & { type?: string; paint?: boolean; layout?: "HORIZONTAL" | "VERTICAL"; visible?: boolean; id?: string } = {},
): NodeLike => ({
  id: p.id ?? `1:${++n}`,
  name,
  type: p.type ?? "FRAME",
  visible: p.visible ?? true,
  hasVisiblePaint: p.paint ?? false,
  layoutMode: p.layout,
  children,
  ...geo({ w: 600, h: 800, ...p }),
});
