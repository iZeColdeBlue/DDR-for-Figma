// Pure path helpers (posix paths, as used in git).

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "untitled";
}

export function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
}

export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p !== "")
    .join("/");
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function relativePath(fromFile: string, toFile: string): string {
  const from = dirname(fromFile).split("/").filter(Boolean);
  const to = toFile.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const ups = from.slice(i).map(() => "..");
  return [...ups, ...to.slice(i)].join("/");
}

/** "I12:3;4:5" -> "I12-3-4-5" (safe in file names; ":" -> "-" as in the blueprint). */
export function nodeIdToFile(nodeId: string): string {
  return nodeId.replace(/[^A-Za-z0-9_-]/g, "-");
}

/** Doc-relative path ("components/buttons.md") -> asset folder slug ("components-buttons"). */
export function assetSlug(relPath: string): string {
  return relPath.replace(/\.md$/i, "").split("/").filter(Boolean).join("-");
}

/** `<docsFolder>/assets/<doc-slug>/<nodeId>.png` */
export function assetPath(docsFolder: string, relPath: string, nodeId: string): string {
  return joinPath(docsFolder, "assets", assetSlug(relPath), nodeIdToFile(nodeId) + ".png");
}

/**
 * Validate/normalise a user-entered doc path (relative to the docs folder).
 * Returns { ok: true, path } or { ok: false, error }.
 */
export function normalizeRelPath(
  input: string,
): { ok: true; path: string } | { ok: false; error: string } {
  let p = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p) return { ok: false, error: "Path is empty." };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return { ok: false, error: "Path contains control characters." };
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".."))
    return { ok: false, error: 'Path must not contain empty, "." or ".." segments.' };
  if (!/\.md$/i.test(p)) p += ".md";
  const base = p.split("/").pop() as string;
  if (base.toLowerCase() === ".md") return { ok: false, error: "File name is empty." };
  if (/^assets(\/|$)/.test(p)) return { ok: false, error: 'The "assets/" folder is reserved for images.' };
  return { ok: true, path: p };
}

/** Pick `base` or `base-2`, `base-3`… (before the .md extension) that is not in `taken` (case-insensitive). */
export function uniqueRelPath(base: string, taken: Iterable<string>): string {
  const set = new Set(Array.from(taken, (t) => t.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  const stem = base.replace(/\.md$/i, "");
  for (let n = 2; ; n++) {
    const cand = `${stem}-${n}.md`;
    if (!set.has(cand.toLowerCase())) return cand;
  }
}
