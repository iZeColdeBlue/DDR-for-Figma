import { beforeEach, describe, expect, it } from "vitest";
import { FakeGitHub } from "./helpers/fakeGitHub";
import { World, type WorldDoc } from "./helpers/world";
import { frame, resetIds, seg, shape, text } from "./helpers/fakeNodes";
import { BranchMovedError, GitHubClient, GitHubError } from "../src/sync/github";
import { loadRemoteState } from "../src/sync/sync";
import { parseManifest } from "../src/sync/manifest";

let gh: FakeGitHub;
let w: World;
let img: ReturnType<typeof shape>;
let introText: ReturnType<typeof text>;

function makeDocs(): WorldDoc[] {
  resetIds();
  introText = text("Intro", [seg("Use buttons to trigger actions.")], { y: 50 });
  img = shape("Primary button", { type: "INSTANCE", y: 100 });
  const buttons = frame("Buttons", [text("T", [seg("Buttons", { fontSize: 32, fontWeight: 700, fontStyle: "Bold" })], { y: 0 }), introText, img, shape("Secondary", { type: "INSTANCE", y: 160 })], { id: "10:1" });
  const voice = frame("Voice", [text("T", [seg("Voice", { fontSize: 32 })], { y: 0 }), text("L", [seg("Be clear\nBe kind", { list: "UNORDERED" })], { y: 50 })], { id: "20:1" });
  const forms = frame("Forms", [text("T", [seg("Forms", { fontSize: 32 })], { y: 0 }), text("P", [seg("Label every field.")], { y: 50 })], { id: "30:1" });
  return [
    { docId: "doc-buttons", relPath: "buttons.md", snapshot: buttons },
    { docId: "doc-voice", relPath: "voice.md", snapshot: voice },
    { docId: "doc-forms", relPath: "forms.md", snapshot: forms },
  ];
}

beforeEach(() => {
  gh = new FakeGitHub();
  w = new World(gh, makeDocs());
});

describe("acceptance §11", () => {
  it("1. three Docs -> ONE commit: 3 .md + images + manifest", async () => {
    const before = gh.commitCount();
    const out = await w.sync();
    expect(out.kind).toBe("committed");
    expect(gh.commitCount()).toBe(before + 1);
    expect(gh.changedPaths()).toEqual(
      [
        "docs/.figma-docs.json",
        `docs/assets/buttons/${ngid(img.id)}.png`,
        `docs/assets/buttons/${ngid(w.docs[0].snapshot.children![3].id)}.png`,
        "docs/buttons.md",
        "docs/forms.md",
        "docs/voice.md",
      ].sort(),
    );
    const files = Object.keys(gh.files());
    expect(files.filter((f) => f.endsWith(".md") && f.startsWith("docs/")).length).toBe(3);
    expect(files.filter((f) => f.endsWith(".png")).length).toBe(2);
    expect(files).toContain("docs/.figma-docs.json");
    expect(gh.commits.get(gh.head)!.message).toBe("docs: sync from Figma (0 updated, 5 added, 0 removed)");
    // manifest SHAs match what is really in the repo
    const manifest = parseManifest(gh.text("docs/.figma-docs.json"));
    for (const d of Object.values(manifest.docs)) for (const [p, s] of Object.entries(d.files)) expect(gh.files()[p]).toBe(s);
    // markdown is what we expect, images relative
    expect(gh.text("docs/buttons.md")).toContain(`![Primary button](assets/buttons/${ngid(img.id)}.png)`);
  });

  it("2. sync again with no changes -> up to date, NO commit", async () => {
    await w.sync();
    const n = gh.commitCount();
    const out = await w.sync();
    expect(out.kind).toBe("up-to-date");
    expect(gh.commitCount()).toBe(n);
    expect(out.diff.docs.every((d) => d.status === "up to date")).toBe(true);
  });

  it("3. edit one text layer -> one commit touching only that .md and the manifest", async () => {
    await w.sync();
    introText.segments = [seg("Use buttons to trigger actions. Updated!")];
    const out = await w.sync();
    expect(out.kind).toBe("committed");
    expect(gh.changedPaths()).toEqual(["docs/.figma-docs.json", "docs/buttons.md"]);
    expect(gh.commits.get(gh.head)!.message).toBe("docs: sync from Figma (1 updated, 0 added, 0 removed)");
    expect(gh.text("docs/buttons.md")).toContain("Updated!");
  });

  it("4. rename a frame -> path unchanged, no new file", async () => {
    await w.sync();
    const filesBefore = Object.keys(gh.files()).sort();
    w.docs[0].snapshot.name = "Buttons (renamed!)"; // relPath is stored in plugin data and does not follow the name
    const out = await w.sync();
    // the title in front matter changes, so the md is updated in place…
    expect(out.kind).toBe("committed");
    expect(gh.changedPaths()).toEqual(["docs/.figma-docs.json", "docs/buttons.md"]);
    // …but no file was added or removed
    expect(Object.keys(gh.files()).sort()).toEqual(filesBefore);
    expect(gh.text("docs/buttons.md")).toContain('title: "Buttons (renamed!)"');
  });

  it("5. delete an image node -> its PNG is removed, only after confirmation", async () => {
    await w.sync();
    const png = `docs/assets/buttons/${ngid(img.id)}.png`;
    expect(gh.files()[png]).toBeDefined();
    w.docs[0].snapshot.children = w.docs[0].snapshot.children!.filter((c) => c !== img);

    const n = gh.commitCount();
    const ask = await w.sync(); // default "ask"
    expect(ask.kind).toBe("needs-confirmation");
    expect(ask.diff.pendingDeletes.map((d) => d.path)).toEqual([png]);
    expect(gh.commitCount()).toBe(n); // nothing happened yet
    expect(gh.files()[png]).toBeDefined();

    const done = await w.sync({ deletes: "yes" });
    expect(done.kind).toBe("committed");
    expect(gh.files()[png]).toBeUndefined();
    expect(gh.changedPaths()).toEqual(["docs/.figma-docs.json", png, "docs/buttons.md"].sort());
    expect(gh.commits.get(gh.head)!.message).toBe("docs: sync from Figma (1 updated, 0 added, 1 removed)");
  });

  it("5b. declining the delete keeps the file but still syncs everything else; it is offered again next time", async () => {
    await w.sync();
    const png = `docs/assets/buttons/${ngid(img.id)}.png`;
    w.docs[0].snapshot.children = w.docs[0].snapshot.children!.filter((c) => c !== img);
    const out = await w.sync({ deletes: "no" });
    expect(out.kind).toBe("committed");
    expect(gh.files()[png]).toBeDefined();
    const again = await w.sync();
    expect(again.kind).toBe("needs-confirmation");
  });

  it("5c. deleting a whole frame removes its files after confirmation", async () => {
    await w.sync();
    w.docs = w.docs.filter((d) => d.docId !== "doc-forms");
    const ask = await w.sync();
    expect(ask.kind).toBe("needs-confirmation");
    expect(ask.diff.orphans[0]).toMatchObject({ docId: "doc-forms", removed: ["docs/forms.md"] });
    await w.sync({ deletes: "yes" });
    expect(gh.files()["docs/forms.md"]).toBeUndefined();
    expect(parseManifest(gh.text("docs/.figma-docs.json")).docs["doc-forms"]).toBeUndefined();
  });

  it("6. edit generated .md on GitHub -> conflict, NOT overwritten; Overwrite replaces it", async () => {
    await w.sync();
    gh.userEdit("docs/voice.md", "# my own edits\n");
    const n = gh.commitCount();
    const out = await w.sync();
    expect(out.diff.docs.find((d) => d.docId === "doc-voice")).toMatchObject({ status: "conflict", conflicts: ["docs/voice.md"] });
    expect(gh.text("docs/voice.md")).toBe("# my own edits\n");
    expect(gh.commitCount()).toBe(n); // nothing else changed -> no commit at all

    // meanwhile other docs still sync
    introText.segments = [seg("changed")];
    const out2 = await w.sync();
    expect(out2.kind).toBe("committed");
    expect(gh.changedPaths()).toEqual(["docs/.figma-docs.json", "docs/buttons.md"]);
    expect(gh.text("docs/voice.md")).toBe("# my own edits\n");

    const out3 = await w.sync({ overwrite: ["doc-voice"] });
    expect(out3.kind).toBe("committed");
    expect(gh.text("docs/voice.md")).toContain("Be clear");
    expect(gh.changedPaths()).toEqual(["docs/voice.md"]); // manifest already had the right SHA
    // and it is clean afterwards
    expect((await w.sync()).kind).toBe("up-to-date");
  });
});

describe("existing repo content", () => {
  it("never overwrites a pre-existing hand-written file on first sync", async () => {
    gh.userEdit("docs/forms.md", "hand written\n");
    const out = await w.sync();
    expect(out.diff.docs.find((d) => d.docId === "doc-forms")!.status).toBe("conflict");
    expect(gh.text("docs/forms.md")).toBe("hand written\n");
    expect(gh.files()["docs/buttons.md"]).toBeDefined(); // others synced
  });
  it("a file deleted in GitHub is restored", async () => {
    await w.sync();
    gh.userEdit("docs/forms.md", null);
    const out = await w.sync();
    expect(out.kind).toBe("committed");
    expect(gh.files()["docs/forms.md"]).toBeDefined();
  });
  it("works with a nested docs folder and an unrelated tree", async () => {
    gh = new FakeGitHub({ "README.md": "x", "src/app.ts": "code", "site/docs/old.md": "old" });
    w = new World(gh, makeDocs(), "site/docs");
    await w.sync();
    expect(Object.keys(gh.files())).toContain("site/docs/.figma-docs.json");
    expect(Object.keys(gh.files())).toContain("site/docs/buttons.md");
    expect(gh.files()["site/docs/old.md"]).toBeDefined();
    expect((await w.sync()).kind).toBe("up-to-date");
  });
  it("PNG bytes changing (image edited in Figma) updates just that PNG", async () => {
    await w.sync();
    w.imageVersion.set(img.id, 1);
    const out = await w.sync();
    expect(out.kind).toBe("committed");
    expect(gh.changedPaths()).toEqual(["docs/.figma-docs.json", `docs/assets/buttons/${ngid(img.id)}.png`]);
  });
});

describe("retry, errors", () => {
  it("branch moved during sync -> refetch and retry once, still ONE commit of ours", async () => {
    let fired = false;
    gh.beforeRefUpdate = () => {
      if (!fired) {
        fired = true;
        gh.userEdit("unrelated.txt", "someone pushed");
      }
    };
    const msgs: string[] = [];
    const out = await w.sync({ onProgress: (m) => msgs.push(m) });
    expect(out.kind).toBe("committed");
    expect(msgs.some((m) => /retrying/i.test(m))).toBe(true);
    expect(gh.files()["unrelated.txt"]).toBeDefined(); // their push survived
    expect(gh.files()["docs/buttons.md"]).toBeDefined();
    expect(gh.commitCount()).toBe(3); // initial + theirs + ours
  });
  it("retry re-evaluates conflicts against the new remote state", async () => {
    await w.sync();
    introText.segments = [seg("v2")];
    let fired = false;
    gh.beforeRefUpdate = () => {
      if (!fired) {
        fired = true;
        gh.userEdit("docs/buttons.md", "edited while we were syncing\n");
      }
    };
    const out = await w.sync();
    expect(out.kind).toBe("up-to-date");
    expect(out.diff.docs.find((d) => d.docId === "doc-buttons")!.status).toBe("conflict");
    expect(gh.text("docs/buttons.md")).toBe("edited while we were syncing\n");
  });
  it("branch keeps moving -> gives up with BranchMovedError after one retry", async () => {
    gh.beforeRefUpdate = () => gh.userEdit(`x${Math.random()}.txt`, "again");
    await expect(w.sync()).rejects.toBeInstanceOf(BranchMovedError);
  });
  it("401: clear message, token never leaks", async () => {
    const bad = w.client({ token: "ghp_WRONG_SECRET_VALUE" });
    const err = await w.sync({ client: bad }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe("auth");
    expect(String(err.message)).not.toContain("ghp_WRONG_SECRET_VALUE");
  });
  it("404 (wrong repo/branch) and 403 permission and rate limit have distinct kinds", async () => {
    const wrongBranch = w.client({ branch: "nope" });
    expect((await w.sync({ client: wrongBranch }).catch((e) => e)).kind).toBe("notfound");

    gh.failures.push({ match: /GET \/git\/ref/, status: 403, body: { message: "Resource not accessible by personal access token" }, times: 1 });
    expect((await w.sync().catch((e) => e)).kind).toBe("permission");

    gh.failures.push({ match: /GET \/git\/ref/, status: 403, headers: { "x-ratelimit-remaining": "0" }, body: { message: "API rate limit exceeded" }, times: 1 });
    expect((await w.sync().catch((e) => e)).kind).toBe("ratelimit");
  });
  it("empty repository gives a helpful error", async () => {
    gh.failures.push({ match: /GET \/git\/ref/, status: 409, body: { message: "Git Repository is empty." }, times: 1 });
    expect((await w.sync().catch((e) => e)).kind).toBe("empty");
  });
  it("transient 5xx and network errors are retried; persistent ones surface", async () => {
    gh.failures.push({ match: /GET \/git\/ref/, status: 502, times: 2 });
    gh.failures.push({ match: /POST \/git\/blobs/, network: true, times: 1 });
    expect((await w.sync()).kind).toBe("committed");

    const gh2 = new FakeGitHub();
    gh2.failures.push({ match: /GET/, network: true, times: 99 });
    const w2 = new World(gh2, makeDocs());
    const err = await w2.sync().catch((e) => e);
    expect(err.kind).toBe("network");
  });
  it("a failed sync leaves the repo untouched (no partial commit)", async () => {
    const before = gh.head;
    gh.failures.push({ match: /POST \/git\/commits/, status: 500, times: 99 });
    await expect(w.sync()).rejects.toBeInstanceOf(GitHubError);
    expect(gh.head).toBe(before);
  });
  it("a corrupt manifest in the repo stops the sync instead of being treated as empty", async () => {
    gh.userEdit("docs/.figma-docs.json", "{broken");
    await expect(w.sync()).rejects.toThrow(/not valid JSON/);
    expect(gh.text("docs/.figma-docs.json")).toBe("{broken");
  });
  it("token only goes in the Authorization header, never in a body", async () => {
    await w.sync();
    expect(gh.requestBodies.some((b) => b.includes(gh.token))).toBe(false);
    expect(JSON.stringify(gh.log)).not.toContain(gh.token);
  });
  it("loadRemoteState: no manifest -> empty; branch names with slashes work", async () => {
    gh.branch = "feature/docs";
    const s = await loadRemoteState(w.client({ branch: "feature/docs" }), "docs");
    expect(s.manifest).toEqual({ version: 1, docs: {} });
  });
  it("hash mismatch between local and GitHub blob sha aborts", async () => {
    const real = gh.fetch;
    const client = new GitHubClient(
      { owner: gh.owner, repo: gh.repo, branch: gh.branch, token: gh.token, fetch: async (u, i) => {
        const r = await real(u, i);
        if (String(u).endsWith("/git/blobs") && i?.method === "POST") return new Response(JSON.stringify({ sha: "0".repeat(40) }), { status: 201 });
        return r;
      } },
      async () => {},
    );
    await expect(w.sync({ client })).rejects.toThrow(/Hash mismatch/);
  });
});

function ngid(id: string) {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}
