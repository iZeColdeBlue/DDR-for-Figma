import type { DocModel } from "../../src/types";

const t = (text: string, f: Partial<{ bold: boolean; italic: boolean; code: boolean; href: string }> = {}) => ({ text, ...f });

/** 1. Text-only page */
export const textOnly: DocModel = {
  docId: "11111111-1111-4111-8111-111111111111",
  title: "Getting started",
  path: "docs/getting-started.md",
  figma: { fileKey: "AbCdEfGhIjKlMnOp", nodeId: "1:2" },
  blocks: [
    { type: "heading", level: 1, spans: [t("Getting started", { bold: true })] },
    { type: "paragraph", spans: [t("Welcome to the design system. This page explains "), t("how to use it", { bold: true }), t(" and "), t("where to ask", { italic: true }), t(" for help.")] },
    { type: "heading", level: 2, spans: [t("Principles")] },
    { type: "paragraph", spans: [t("Keep it simple, use "), t("tokens", { code: true }), t(" instead of raw values, and prefer 2 * 3 = 6 over magic numbers_like_this.")] },
    { type: "heading", level: 3, spans: [t("Escaping")] },
    { type: "paragraph", spans: [t("# not a heading, - not a list, 1. not a list, <b>not html</b> and [not a link](x).")] },
  ],
};

/** 2. Page with images */
export const withImages: DocModel = {
  docId: "22222222-2222-4222-8222-222222222222",
  title: "Buttons",
  path: "docs/buttons.md",
  figma: { fileKey: "AbCdEfGhIjKlMnOp", nodeId: "12:300" },
  blocks: [
    { type: "heading", level: 1, spans: [t("Buttons")] },
    { type: "paragraph", spans: [t("Use buttons to trigger actions.")] },
    { type: "image", assetId: "12-345", alt: "Primary button", nodeId: "12:345" },
    { type: "heading", level: 2, spans: [t("States")] },
    { type: "image", assetId: "I12-346-1-2", alt: "States [hover] & focus", nodeId: "I12:346;1:2" },
    { type: "paragraph", spans: [t("Disabled buttons never show a tooltip.")] },
  ],
};

/** 3. Page with lists and links, in a nested folder, no fileKey */
export const listsAndLinks: DocModel = {
  docId: "33333333-3333-4333-8333-333333333333",
  title: "Content guidelines: voice & tone",
  path: "docs/content/voice.md",
  figma: { nodeId: "40:1" },
  blocks: [
    { type: "heading", level: 1, spans: [t("Voice & tone")] },
    { type: "paragraph", spans: [t("Read the "), t("style guide", { href: "https://example.com/style guide(1)" }), t(" and "), t("our glossary", { href: "https://example.com/glossary", bold: true }), t(".")] },
    { type: "list", ordered: false, items: [[t("Be clear")], [t("Be "), t("kind", { italic: true })], [t("Avoid "), t("jargon", { bold: true, italic: true })]] },
    { type: "heading", level: 2, spans: [t("Checklist")] },
    { type: "list", ordered: true, items: [[t("Draft")], [t("Review with "), t("a teammate", { href: "https://example.com/people" })], [t("Publish")]] },
    { type: "image", assetId: "40-2", alt: "Tone scale", nodeId: "40:2" },
  ],
};

export const allFixtures = { textOnly, withImages, listsAndLinks };
