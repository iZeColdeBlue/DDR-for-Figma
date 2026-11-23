const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function encodeBase64(bytes) {
    const parts = [];
    const CHUNK = 3 * 16384; // multiple of 3 so chunks concatenate cleanly
    for (let off = 0; off < bytes.length; off += CHUNK) {
        const end = Math.min(off + CHUNK, bytes.length);
        let s = "";
        let i = off;
        for (; i + 2 < end; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            s += CHARS[n >> 18] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + CHARS[n & 63];
        }
        if (i < end) {
            const rem = end - i;
            const n = (bytes[i] << 16) | ((rem === 2 ? bytes[i + 1] : 0) << 8);
            s += CHARS[n >> 18] + CHARS[(n >> 12) & 63] + (rem === 2 ? CHARS[(n >> 6) & 63] : "=") + "=";
        }
        parts.push(s);
    }
    return parts.join("");
}
export function decodeBase64(b64) {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < clean.length; i += 4) {
        const a = CHARS.indexOf(clean[i]);
        const b = CHARS.indexOf(clean[i + 1]);
        const c = i + 2 < clean.length ? CHARS.indexOf(clean[i + 2]) : -1;
        const d = i + 3 < clean.length ? CHARS.indexOf(clean[i + 3]) : -1;
        out[o++] = (a << 2) | (b >> 4);
        if (c >= 0)
            out[o++] = ((b & 15) << 4) | (c >> 2);
        if (d >= 0)
            out[o++] = ((c & 3) << 6) | d;
    }
    return out.subarray(0, o);
}
