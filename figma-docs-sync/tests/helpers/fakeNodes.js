let n = 100;
export const resetIds = () => (n = 100);
export const seg = (text, o = {}) => ({
    text,
    fontSize: 16,
    fontFamily: "Inter",
    fontStyle: "Regular",
    fontWeight: 400,
    list: "NONE",
    indentation: 0,
    ...o,
});
const geo = (p) => ({ x: p.x ?? 0, y: p.y ?? 0, width: p.w ?? 100, height: p.h ?? 20 });
export const text = (name, segments, p = {}) => ({
    id: `1:${++n}`,
    name,
    type: "TEXT",
    visible: p.visible ?? true,
    hasVisiblePaint: true,
    segments,
    ...geo(p),
});
export const shape = (name, p = {}) => ({
    id: `1:${++n}`,
    name,
    type: p.type ?? "RECTANGLE",
    visible: p.visible ?? true,
    hasVisiblePaint: true,
    ...geo({ h: 40, ...p }),
});
export const frame = (name, children, p = {}) => ({
    id: p.id ?? `1:${++n}`,
    name,
    type: p.type ?? "FRAME",
    visible: p.visible ?? true,
    hasVisiblePaint: p.paint ?? false,
    layoutMode: p.layout,
    children,
    ...geo({ w: 600, h: 800, ...p }),
});
