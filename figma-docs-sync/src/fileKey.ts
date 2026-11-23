/** Extract the file key from a Figma URL (design/file/board/slides/make). */
export function parseFileKey(url: string): string | undefined {
  const m = /figma\.com\/(?:design|file|board|slides|make|proto)\/([0-9A-Za-z]{10,})/.exec(url.trim());
  return m ? m[1] : undefined;
}
