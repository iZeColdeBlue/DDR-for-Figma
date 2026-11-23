# REPORT

## Bottom line

All code for M0–M4 is written, type-checks and builds. 130 automated tests pass, and a browser-driven UI test passes. **The plugin has never been run inside real Figma, and the sync has never run against real GitHub.** Both need a human pass; see "Needs a human" below. Treat the Figma-facing code (`src/extract/figmaHost.ts`, `src/main.ts`) as untested against the real Plugin API until then.

## 1. Spike results (run in a scratch Figma file via Plugin API calls, not inside a plugin)

| Spike | Result |
|---|---|
| PNG determinism | Same node exported twice at 2× in one session: **byte-identical** (rectangle with drop shadow: 15,575 B; doc frame: 44,850 B; 1440×4000 frame at 1× and 2×). Not tested: across sessions, machines or Figma versions. **No fingerprint was built.** You chose option 3: PNG hash first, fingerprint only if real Figma shows drift or slowness. |
| `getStyledTextSegments` | Reports `fontSize`, `fontName` (family and style), `fontWeight`, `hyperlink`, `textStyleId` and `listOptions` (`ORDERED`/`UNORDERED`) correctly. A multi-line list is **one segment**, so paragraphs must be split on `\n` (implemented). `textStyleId` is `""` when unstyled, so the font-size-rank fallback matters. There is no monospace flag, so detection is by font family name. |
| Large frame | Synthetic worst case (1440×4000, 400 gradient and blurred ellipses): 3.9 MB / 4.2 s at 1×, **12.5 MB / 13.1 s at 2×**. Export time is the real cost, not size. Hashing a 12 MB buffer in the plugin's pure-JS SHA-1 stays under a few seconds (tested). **Not measured:** `postMessage` of 12 MB, and GitHub's blob limit (documented as 100 MB for the Git Data API, from memory, not tested). |

## 2. Acceptance tests (§11)

"Mock" = simulated pipeline (fake node trees → real `buildDoc` → real sync code) against the in-memory fake GitHub API in `tests/helpers/fakeGitHub.ts`. "Browser" = `scripts/ui-e2e.mjs`: the real built `ui.html` in headless Chromium, with a stub standing in for the plugin main thread and `api.github.com` routed to the fake.

| # | Test | Verified how |
|---|---|---|
| 1 | 3 Docs → one commit, 3 `.md` + images + manifest | Mock (`tests/sync.test.ts`); Browser (2 Docs, one commit) |
| 2 | Sync again → "Everything up to date", no commit | Mock; Browser |
| 3 | Edit one text layer → one commit with only that `.md` and the manifest | Mock |
| 4 | Rename a frame → path unchanged, no new file | Mock. The path lives in plugin data, so it does not follow the name. **Side effect:** `title:` in the front matter is the frame name, so the existing `.md` is updated in place. |
| 5 | Delete an image node → PNG removed after confirmation | Mock (ask / yes / no paths, plus whole-frame deletion); Browser (confirmation modal, then delete) |
| 6 | Edit the generated `.md` on GitHub, then sync → `conflict`, not overwritten | Mock (including Overwrite and retry-time conflicts); Browser (conflict chip, in-page Overwrite modal, then overwrite) |
| 7 | Someone not on the team marks and syncs a frame without help | **Needs a human.** |

## Needs a human (real Figma / real GitHub)

- **M0 "done when":** mark a real frame and see it in the list with a stable `docId`. This needs plugin data, `loadAllPagesAsync`, `findAllWithCriteria({pluginData})` and selection events, which only exist in real Figma. Also check that the manifest imports (it has no `id`).
- **M1:** three realistic frames converting well. Extraction rules are tested on hand-built trees. How the snapshot adapter (`figmaHost.ts`) reads real nodes (fills, strokes, effects, text styles) is not.
- **M2:** unzip and confirm images show on GitHub.
- **Real GitHub:** one run against a throwaway repo. The CORS and `Authorization` header from the UI iframe, branch protection, and the real tree/blob endpoints are only covered by the fake.
- **Sync UX:** timing with big images. Every refresh re-exports every image at 2×, which could take a long time on large Docs (spike 3).
- **PNG determinism across sessions**, the only way the "noisy commits" risk shows up.

## 3. Decisions the blueprint did not specify

- **Path storage:** plugin data holds the path *relative to the docs folder* (`buttons.md`). The full path is built at build time, so changing the docs folder in Settings moves everything. Plugin data keys: `fds.docId`, `fds.relPath`, `fds.nodeId`.
- **Path lock:** a Doc is "locked" in the UI once the manifest knows it. **Change path** is an explicit action; the diff then deletes the old files (with confirmation) and adds the new ones.
- **Conflict rules:**
  - A conflict skips the *whole* Doc (its `.md` and images), so images and text never drift apart.
  - A pre-existing file at a path we have never tracked, with different content, is a conflict. The sync never clobbers hand-written files on first run.
  - If the file in GitHub already equals what Figma would write, it is adopted (no write).
  - A tracked file deleted in GitHub is restored, not treated as a conflict, because nothing is overwritten.
  - A removed image that someone edited in GitHub is kept and reported as a conflict.
- **Delete flow:** "Delete N files" / "Keep them, sync the rest" / "Cancel sync". Kept files stay in the manifest, so you are asked again next time.
- **Commit message** counts files, excluding the manifest: `(N updated, M added, K removed)`. A manifest-only change (such as adopting a file) still commits, with zeros.
- **Manifest SHAs** for unchanged Docs are left as they were (including `nodeId`), so a frame ID change alone does not cause a commit.
- **Remote state** comes from the Git Trees API (one recursive tree of the docs folder), not the Contents API, to avoid its size limits. The manifest is read as a blob. A corrupt manifest stops the sync with an error instead of being treated as empty.
- **Retries:** 5xx and network errors get 2 retries (0.5 s, 1.5 s). A moved branch is refetched and retried once; **conflicts are re-evaluated against the new remote state**, not reused.
- **Hash check:** the sync aborts if GitHub's blob SHA differs from the locally computed one.
- **Duplicate frames:** detected by two frames sharing a `docId`; the copy is the one whose stored `nodeId` no longer matches its own id. The UI offers "Assign new ID" and **blocks sync until resolved**.
- **Headings:**
  - Body size is the most common size by character count.
  - Style names are matched by regex: `H1`–`H6`, `Heading N`, `Title`, `Subtitle`, and body-like names that force a paragraph.
  - Levels above 4 become H4.
  - Bold inside a heading is dropped. There is no synthesised H1 from the frame name; the title goes in front matter.
- **Markdown details:**
  - Blocks are separated by blank lines (the blueprint example showed none).
  - Special characters are escaped contextually.
  - Titles are YAML-quoted when needed.
  - Image alt text and URLs are escaped.
- **Failed exports:** an image that cannot be exported (such as a zero-height line) is dropped from the Markdown with a warning shown on the Doc card, so there are no broken links.
- **Zip:** contains the docs and assets but not the manifest (it is sync state).
- **File key:** `figma.fileKey`, else parsed from an optional Figma file URL in Settings, else the `figma:` front-matter line is omitted.
- **Preview:** a small purpose-built renderer for the subset we emit (no Markdown library), plus a raw-source tab. The UI is plain DOM (no Preact). `window.confirm` does not work in plugin iframes, so confirmations are in-page modals.
- **Dependencies:** beyond §8 (TypeScript, plugin typings, esbuild, fflate), only dev tooling: `vitest`, `@vitest/coverage-v8`, `@types/node`. Playwright, already installed in this environment, is used only by the optional `e2e:ui` script.
- **No spec conflicts found** between the prompt and the blueprint, apart from the rename side effect noted under test 4.

## 4. Known limitations

- **Never run in real Figma or against real GitHub** (see above).
- **Image change detection** uses PNG bytes, so every refresh exports every image at 2× (the cost from spike 3). The fingerprint fallback is not built.
- **Lists:** nested lists are flattened to one level (the DocModel v1 has no nesting). Tables, code blocks and callouts are not produced (parking lot).
- **Text:** line breaks inside a paragraph (`U+2028`) become spaces. Text inside component instances is part of the instance's image, not text.
- **Children of auto-layout frames** that are absolutely positioned are ordered by child order, not position.
- **Doc in a Doc:** a Doc frame nested inside another Doc is exported as part of the outer one.
- **Paths:** swapping paths between two Docs in one sync shows conflicts. Two Docs with the same path are refused.
- **Repo shape:** an empty repository, a branch without commits, a protected branch and a docs folder too large for one tree listing all fail with a clear message rather than working.
- **No "Unmark Doc" action.** It is not in the blueprint; a mistaken Doc can be cleared by deleting the frame (its files go through the delete confirmation).
- **Scanning:** listing Docs loads every page of the file (`documentAccess: dynamic-page` requires it), which can be slow in very large files.
- **Token handling:** the token is held in UI memory while the plugin is open and sent only to `api.github.com`.
