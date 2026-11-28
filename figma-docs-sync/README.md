# Figma Docs Sync (MVP)

A Figma plugin that turns frames on the canvas into Markdown documentation and syncs them to a GitHub
repo. Mark a frame as a **Doc**, press **Sync**, and one commit updates only the files that changed.
Sync is one-way (Figma → GitHub). The full spec is the blueprint this was built from (milestones M0–M4).

```
Figma nodes ──extract──▶ DocModel (JSON) ──render──▶ files {path, bytes} ──sync──▶ GitHub
 src/extract/            src/types.ts      src/render/markdown.ts           src/sync/
```

- Only `src/extract/` touches the `figma` global (`figmaHost.ts` is the single Figma I/O file). A test enforces this.
- `render` and `sync` are pure TypeScript with no Figma dependency. Only the standard Plugin API is used:
  no Figma MCP, Dev Mode, REST API or backend.

## Build

```bash
npm install
npm run build        # -> dist/code.js and dist/ui.html
```

## Load in Figma

1. Open the **Figma desktop app** (development plugins need it).
2. Menu → **Plugins → Development → Import plugin from manifest…**
3. Choose `manifest.json` in this folder.
4. Run it via **Plugins → Development → Figma Docs Sync**.

`manifest.json` has no `id`. Figma assigns one on import/publish; if the import dialog asks for one, add
any id it suggests.

## Create the GitHub token (fine-grained, single repo)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → pick the docs repo.
3. **Repository permissions → Contents: Read and write.** (Nothing else is needed.)
4. Set an expiry, generate, and copy the token.
5. In the plugin: **Settings** → owner, repo, branch, docs folder (default `docs`), paste the token →
   **Save & test connection**.

The token is stored only in `figma.clientStorage` (per user, per machine); it is never written to plugin
data, the Figma file, logs, commits or fixtures. If the branch is protected against direct pushes, the
sync fails with a permission error (pull-request mode is out of scope for the MVP).

## Use

1. Select a frame → **Mark as Doc**. A stable `docId` and a path (slug of the frame name) are stored on the frame. Edit the path before the first sync if you like.
2. The list shows each Doc's status: `new` · `changed` · `up to date` · `conflict`.
3. **Preview** shows rendered Markdown (or the raw source) for a Doc.
4. **Sync** commits all new/changed Docs in one commit and links to it. **Download .zip** gives the same files without GitHub.

How a frame is converted: text becomes Markdown text (headings from text-style names such as `H1`/`Heading 2`/`Title`,
else by font-size rank; lists, bold, italic, links and monospace are kept). Transparent containers
(frames/groups without fill, stroke or effect) are looked into. Anything else (a frame with a background,
components, instances, vectors, images) becomes a 2× PNG. Hidden layers and layers whose name starts with
`_` are skipped.

## Tests

```bash
npm test             # vitest: render, extract (fake node trees), diff, GitHub sync (fake API), architecture rules
npm run typecheck
npm run check        # both
npm run coverage     # coverage of render/sync/extract logic
npm run harness:ui   # serves dist/ui.html with a stub main thread + fake GitHub on http://localhost:4173
```

The GitHub layer is tested against an **in-memory fake of the GitHub Git Data API**
(`tests/helpers/fakeGitHub.ts`), not a real repo. The fake computes real git blob SHAs and simulates
branch moves, 4xx/5xx errors and network failures.

## Layout

```
manifest.json            Figma manifest (networkAccess: https://api.github.com)
src/extract/             the only code that sees `figma`: nodeLike.ts (thin interface), extract.ts (rules), figmaHost.ts (Figma I/O)
src/render/markdown.ts   DocModel -> Markdown + asset list
src/sync/                sha1 (git blob SHA), diff, manifest, github (Git Data API client), sync (one commit)
src/build.ts             snapshot -> extract -> export -> render -> files with SHAs
src/main.ts              plugin main thread (orchestration only)
src/ui/                  plugin UI iframe: settings, doc list, preview, sync, zip
tests/                   unit + simulated end-to-end tests, fixtures (3 DocModels + golden Markdown)
```
