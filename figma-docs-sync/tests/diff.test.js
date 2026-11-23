import { describe, expect, it } from "vitest";
import { computeDiff, findPathCollisions } from "../src/sync/diff";
import { emptyManifest, parseManifest, serializeManifest } from "../src/sync/manifest";
const MD = "docs/a.md";
const IMG = "docs/assets/a/1-2.png";
const doc = (files, over = {}) => ({ docId: "A", path: MD, nodeId: "1:1", files, ...over });
const man = (files, over = {}) => ({
    version: 1,
    docs: { A: { path: MD, nodeId: "1:1", files, ...over } },
});
describe("computeDiff – docs present in Figma", () => {
    it("new doc: everything is added, status new", () => {
        const r = computeDiff({ docs: [doc({ [MD]: "m1", [IMG]: "i1" })], manifest: emptyManifest(), remote: {} });
        expect(r.docs[0]).toMatchObject({ status: "new", added: [MD, IMG], updated: [], conflicts: [] });
        expect(r.writes.map((w) => w.kind)).toEqual(["add", "add"]);
        expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1", [IMG]: "i1" });
        expect(r.changed).toBe(true);
        expect(r.counts).toEqual({ updated: 0, added: 2, removed: 0 });
    });
    it("nothing changed: up to date, no commit", () => {
        const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1" }), remote: { [MD]: "m1" } });
        expect(r.docs[0].status).toBe("up to date");
        expect(r.writes).toEqual([]);
        expect(r.changed).toBe(false);
    });
    it("nodeId change alone does not cause a commit", () => {
        const r = computeDiff({ docs: [doc({ [MD]: "m1" }, { nodeId: "9:9" })], manifest: man({ [MD]: "m1" }), remote: { [MD]: "m1" } });
        expect(r.changed).toBe(false);
        expect(r.manifest.docs.A.nodeId).toBe("1:1");
    });
    it("figma text edit: only the md is updated", () => {
        const r = computeDiff({ docs: [doc({ [MD]: "m2", [IMG]: "i1" })], manifest: man({ [MD]: "m1", [IMG]: "i1" }), remote: { [MD]: "m1", [IMG]: "i1" } });
        expect(r.docs[0]).toMatchObject({ status: "changed", updated: [MD], added: [] });
        expect(r.writes).toEqual([{ path: MD, docId: "A", sha: "m2", kind: "update" }]);
        expect(r.counts).toEqual({ updated: 1, added: 0, removed: 0 });
        expect(r.manifest.docs.A.files[MD]).toBe("m2");
    });
    it("tracked file missing in the repo is restored (not a conflict)", () => {
        const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1" }), remote: {} });
        expect(r.docs[0].status).toBe("changed");
        expect(r.writes).toEqual([{ path: MD, docId: "A", sha: "m1", kind: "add" }]);
    });
    describe("conflicts", () => {
        it("md edited in GitHub, Figma unchanged -> conflict, nothing written", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1" }), remote: { [MD]: "edited" } });
            expect(r.docs[0]).toMatchObject({ status: "conflict", conflicts: [MD] });
            expect(r.writes).toEqual([]);
            expect(r.deletes).toEqual([]);
            expect(r.manifest.docs.A.files[MD]).toBe("m1"); // entry untouched
            expect(r.changed).toBe(false);
        });
        it("md edited in GitHub AND changed in Figma -> conflict, whole doc skipped (images too)", () => {
            const r = computeDiff({
                docs: [doc({ [MD]: "m2", [IMG]: "i2" })],
                manifest: man({ [MD]: "m1", [IMG]: "i1" }),
                remote: { [MD]: "edited", [IMG]: "i1" },
            });
            expect(r.docs[0].status).toBe("conflict");
            expect(r.writes).toEqual([]);
            expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1", [IMG]: "i1" });
        });
        it("one doc in conflict does not block the others", () => {
            const b = { docId: "B", path: "docs/b.md", nodeId: "2:2", files: { "docs/b.md": "b1" } };
            const r = computeDiff({ docs: [doc({ [MD]: "m1" }), b], manifest: man({ [MD]: "m1" }), remote: { [MD]: "edited" } });
            expect(r.docs.map((d) => d.status)).toEqual(["conflict", "new"]);
            expect(r.writes.map((w) => w.path)).toEqual(["docs/b.md"]);
        });
        it("edited in GitHub to exactly what Figma produces -> adopted, no conflict, manifest updated", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m2" })], manifest: man({ [MD]: "m1" }), remote: { [MD]: "m2" } });
            expect(r.docs[0].status).toBe("changed");
            expect(r.writes).toEqual([]);
            expect(r.manifest.docs.A.files[MD]).toBe("m2");
            expect(r.changed).toBe(true); // manifest-only commit
        });
        it("pre-existing untracked file with different content is a conflict (never clobbered)", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: emptyManifest(), remote: { [MD]: "handwritten" } });
            expect(r.docs[0]).toMatchObject({ status: "conflict", conflicts: [MD] });
            expect(r.writes).toEqual([]);
            expect(r.manifest.docs.A).toBeUndefined();
        });
        it("pre-existing untracked file with identical content is adopted", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: emptyManifest(), remote: { [MD]: "m1" } });
            expect(r.docs[0].status).toBe("new");
            expect(r.writes).toEqual([]);
            expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1" });
            expect(r.changed).toBe(true);
        });
        it("overwrite chosen: edited file is replaced", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1" }), remote: { [MD]: "edited" }, overwrite: new Set(["A"]) });
            expect(r.docs[0].status).toBe("changed");
            expect(r.writes).toEqual([{ path: MD, docId: "A", sha: "m1", kind: "update" }]);
        });
        it("overwrite chosen for untracked pre-existing file", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: emptyManifest(), remote: { [MD]: "handwritten" }, overwrite: new Set(["A"]) });
            expect(r.docs[0].status).toBe("new");
            expect(r.writes[0]).toMatchObject({ path: MD, kind: "update" });
        });
        it("removed image edited in GitHub -> conflict, kept", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1", [IMG]: "i1" }), remote: { [MD]: "m1", [IMG]: "other" }, confirmDeletes: true });
            expect(r.docs[0]).toMatchObject({ status: "conflict", conflicts: [IMG] });
            expect(r.deletes).toEqual([]);
        });
        it("removed image edited in GitHub + overwrite -> deleted", () => {
            const r = computeDiff({ docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1", [IMG]: "i1" }), remote: { [MD]: "m1", [IMG]: "other" }, confirmDeletes: true, overwrite: new Set(["A"]) });
            expect(r.deletes).toEqual([{ path: IMG, docId: "A" }]);
        });
    });
    describe("deletes", () => {
        const base = { docs: [doc({ [MD]: "m1" })], manifest: man({ [MD]: "m1", [IMG]: "i1" }), remote: { [MD]: "m1", [IMG]: "i1" } };
        it("removed image is pending until confirmed; stays tracked", () => {
            const r = computeDiff(base);
            expect(r.pendingDeletes).toEqual([{ path: IMG, docId: "A" }]);
            expect(r.deletes).toEqual([]);
            expect(r.docs[0]).toMatchObject({ status: "changed", removed: [IMG] });
            expect(r.manifest.docs.A.files[IMG]).toBe("i1");
            expect(r.changed).toBe(false);
        });
        it("confirmed: image deleted and untracked, counted in commit message numbers", () => {
            const r = computeDiff({ ...base, confirmDeletes: true });
            expect(r.deletes).toEqual([{ path: IMG, docId: "A" }]);
            expect(r.pendingDeletes).toEqual([]);
            expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1" });
            expect(r.changed).toBe(true);
            expect(r.counts.removed).toBe(1);
        });
        it("removed file already gone from the repo: dropped from manifest silently", () => {
            const r = computeDiff({ ...base, remote: { [MD]: "m1" } });
            expect(r.pendingDeletes).toEqual([]);
            expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1" });
            expect(r.docs[0].status).toBe("changed");
            expect(r.changed).toBe(true);
        });
        it("changing a doc's path deletes the old files and adds the new ones", () => {
            const r = computeDiff({
                docs: [doc({ "docs/b.md": "m1" }, { path: "docs/b.md" })],
                manifest: man({ [MD]: "m1" }),
                remote: { [MD]: "m1" },
                confirmDeletes: true,
            });
            expect(r.writes.map((w) => w.path)).toEqual(["docs/b.md"]);
            expect(r.deletes.map((d) => d.path)).toEqual([MD]);
            expect(r.manifest.docs.A.path).toBe("docs/b.md");
        });
    });
});
describe("computeDiff – docs whose frame is gone (orphans)", () => {
    const manifest = man({ [MD]: "m1", [IMG]: "i1" });
    it("pending until confirmed; entry kept", () => {
        const r = computeDiff({ docs: [], manifest, remote: { [MD]: "m1", [IMG]: "i1" } });
        expect(r.orphans).toEqual([{ docId: "A", path: MD, removed: [MD, IMG], conflicts: [] }]);
        expect(r.pendingDeletes.length).toBe(2);
        expect(Object.keys(r.manifest.docs.A.files)).toEqual([MD, IMG]);
        expect(r.changed).toBe(false);
    });
    it("confirmed: all files deleted, entry removed", () => {
        const r = computeDiff({ docs: [], manifest, remote: { [MD]: "m1", [IMG]: "i1" }, confirmDeletes: true });
        expect(r.deletes.map((d) => d.path)).toEqual([MD, IMG]);
        expect(r.manifest.docs).toEqual({});
        expect(r.changed).toBe(true);
    });
    it("file edited in GitHub is kept and stays tracked", () => {
        const r = computeDiff({ docs: [], manifest, remote: { [MD]: "edited", [IMG]: "i1" }, confirmDeletes: true });
        expect(r.orphans[0]).toMatchObject({ removed: [IMG], conflicts: [MD] });
        expect(r.deletes.map((d) => d.path)).toEqual([IMG]);
        expect(r.manifest.docs.A.files).toEqual({ [MD]: "m1" });
    });
    it("overwrite deletes even edited files", () => {
        const r = computeDiff({ docs: [], manifest, remote: { [MD]: "edited", [IMG]: "i1" }, confirmDeletes: true, overwrite: new Set(["A"]) });
        expect(r.deletes.map((d) => d.path)).toEqual([MD, IMG]);
        expect(r.manifest.docs).toEqual({});
    });
    it("files already gone: entry dropped with nothing to delete", () => {
        const r = computeDiff({ docs: [], manifest, remote: {} });
        expect(r.deletes).toEqual([]);
        expect(r.manifest.docs).toEqual({});
        expect(r.changed).toBe(true);
    });
});
describe("computeDiff – misc", () => {
    it("no docs and no manifest: nothing to do", () => {
        const r = computeDiff({ docs: [], manifest: emptyManifest(), remote: {} });
        expect(r.changed).toBe(false);
    });
    it("two docs producing the same path are rejected", () => {
        const a = doc({ [MD]: "x" });
        const b = { docId: "B", path: MD, nodeId: "2:2", files: { [MD]: "y" } };
        expect(findPathCollisions([a, b]).length).toBe(1);
        expect(() => computeDiff({ docs: [a, b], manifest: emptyManifest(), remote: {} })).toThrow(/more than one Doc/);
    });
});
describe("manifest (de)serialisation", () => {
    it("is deterministic regardless of key order", () => {
        const a = serializeManifest({ version: 1, docs: { B: { path: "b", nodeId: "2", files: { z: "1", a: "2" } }, A: { path: "a", nodeId: "1", files: {} } } });
        const b = serializeManifest({ version: 1, docs: { A: { path: "a", nodeId: "1", files: {} }, B: { path: "b", nodeId: "2", files: { a: "2", z: "1" } } } });
        expect(a).toBe(b);
        expect(a.endsWith("\n")).toBe(true);
    });
    it("round-trips", () => {
        const m = man({ [MD]: "m1" });
        expect(parseManifest(serializeManifest(m))).toEqual(m);
    });
    it("rejects garbage with readable errors (never treated as empty)", () => {
        expect(() => parseManifest("{nope")).toThrow(/not valid JSON/);
        expect(() => parseManifest('{"version":2,"docs":{}}')).toThrow(/unsupported/);
        expect(() => parseManifest('{"version":1,"docs":{"A":{"path":1}}}')).toThrow(/malformed/);
    });
});
