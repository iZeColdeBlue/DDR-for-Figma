// Pure path helpers (posix paths, as used in git).
export function slugify(name) {
    const s = name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return s || "untitled";
}
export function normalizeFolder(folder) {
    return folder
        .trim()
        .replace(/\\/g, "/")
        .split("/")
        .filter((s) => s !== "" && s !== ".")
        .join("/");
}
export function joinPath(...parts) {
    return parts
        .map((p) => p.replace(/^\/+|\/+$/g, ""))
        .filter((p) => p !== "")
        .join("/");
}
export function dirname(p) {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
}
export function relativePath(fromFile, toFile) {
    const from = dirname(fromFile).split("/").filter(Boolean);
    const to = toFile.split("/").filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i])
        i++;
    const ups = from.slice(i).map(() => "..");
    return [...ups, ...to.slice(i)].join("/");
}
/** "I12:3;4:5" -> "I12-3-4-5" (safe in file names; ":" -> "-" as in the blueprint). */
export function nodeIdToFile(nodeId) {
    return nodeId.replace(/[^A-Za-z0-9_-]/g, "-");
}
/** Doc-relative path ("components/buttons.md") -> asset folder slug ("components-buttons"). */
export function assetSlug(relPath) {
    return relPath.replace(/\.md$/i, "").split("/").filter(Boolean).join("-");
}
/** `<docsFolder>/assets/<doc-slug>/<nodeId>.png` */
export function assetPath(docsFolder, relPath, nodeId) {
    return joinPath(docsFolder, "assets", assetSlug(relPath), nodeIdToFile(nodeId) + ".png");
}
/**
 * Validate/normalise a user-entered doc path (relative to the docs folder).
 * Returns { ok: true, path } or { ok: false, error }.
 */
export function normalizeRelPath(input) {
    let p = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p)
        return { ok: false, error: "Path is empty." };
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(p))
        return { ok: false, error: "Path contains control characters." };
    const segs = p.split("/");
    if (segs.some((s) => s === "" || s === "." || s === ".."))
        return { ok: false, error: 'Path must not contain empty, "." or ".." segments.' };
    if (!/\.md$/i.test(p))
        p += ".md";
    const base = p.split("/").pop();
    if (base.toLowerCase() === ".md")
        return { ok: false, error: "File name is empty." };
    if (/^assets(\/|$)/.test(p))
        return { ok: false, error: 'The "assets/" folder is reserved for images.' };
    return { ok: true, path: p };
}
/** Pick `base` or `base-2`, `base-3`… (before the .md extension) that is not in `taken` (case-insensitive). */
export function uniqueRelPath(base, taken) {
    const set = new Set(Array.from(taken, (t) => t.toLowerCase()));
    if (!set.has(base.toLowerCase()))
        return base;
    const stem = base.replace(/\.md$/i, "");
    for (let n = 2;; n++) {
        const cand = `${stem}-${n}.md`;
        if (!set.has(cand.toLowerCase()))
            return cand;
    }
}
