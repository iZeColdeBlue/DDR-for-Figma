Implement the new UI of the Figma Docs Sync plugin from the design handoff in `design/handover/` (this folder).

Context: we already talked through the plugin and its architecture, so this is about building the designed screens and behaviour into the existing code, not re-planning the product.

How to work:
1. Read `HANDOFF.md` completely first. It is the source of truth for flow, states, data storage and open questions. Then look at `screens/png/` to see every screen, and open `prototype/index.html` in a browser to click through the flow.
2. Check open question Q1 (can the plugin write to a local folder?) before anything else and tell me what you find.
3. Ask me about Q2–Q4 before you build those parts. Don't guess.
4. Set up the tokens from `tokens/tokens.css` (and `tokens.json`) as the base of the styling. No raw hex values in components.
5. Build the shared components first (buttons incl. the disabled state, text field with the required/optional marks, banner, notice dialog, progress header, tabs, guide layout), then the screens in the order of the flow (01 → 19).
6. Use `screens/NN-*.html` as the pixel and copy reference. Copy every text word for word. The inline styles there are a spec, not code to paste.
7. Keep the window at 468 × 760, with a fixed header and footer and only the middle scrolling.
8. Follow the accessibility checklist in section 7.
9. Don't build anything listed in section 9 (projects are gone).

When you're done, go through the "Done when" list in section 10 and report what is finished, what deviates from the design and why, and any open questions.
