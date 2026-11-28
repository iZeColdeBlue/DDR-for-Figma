// Used only by the GitHub client in the UI iframe, which has btoa/atob (the main-thread sandbox does not).

export function encodeBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked: spreading a whole multi-MB PNG into fromCharCode overflows the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Accepts GitHub's line-wrapped base64. */
export function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
}
