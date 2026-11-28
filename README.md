# DDR for Figma

The plugin lives in [`figma-docs-sync/`](figma-docs-sync/README.md).

```bash
cd figma-docs-sync
npm install
npm run build      # writes dist/code.js and dist/ui.html
npm run check      # typecheck + tests
```

In Figma, import the plugin from `figma-docs-sync/manifest.json`.

Design material (mockups, handovers, design decisions) lives in [`design/`](design/). It is not part of the plugin and is left out of ZIP downloads.
