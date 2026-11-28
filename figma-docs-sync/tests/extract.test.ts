import { beforeEach, describe, expect, it } from "vitest";
import { extractDoc, levelFromStyleName, orderChildren } from "../src/extract/extract";
import { frame, resetIds, seg, shape, text } from "./helpers/fakeNodes";
import type { Block } from "../src/types";

const meta = { docId: "D", path: "docs/x.md", fileKey: "KEY" };
const run = (root: ReturnType<typeof frame>) => extractDoc(root, meta);
const plain = (b: Block) => (b.type === "heading" || b.type === "paragraph" ? b.spans.map((s) => s.text).join("") : b.type === "list" ? b.items.map((i) => i.map((s) => s.text).join("")) : b.alt);

beforeEach(resetIds);

describe("model basics", () => {
  it("carries meta and node id", () => {
    const m = run(frame("My Doc", [], { id: "5:5" }));
    expect(m).toMatchObject({ docId: "D", title: "My Doc", path: "docs/x.md", figma: { fileKey: "KEY", nodeId: "5:5" }, blocks: [] });
  });
});

describe("reading order (rule 1)", () => {
  it("auto-layout keeps child order even if geometry disagrees", () => {
    const a = text("a", [seg("A")], { y: 100 });
    const b = text("b", [seg("B")], { y: 0 });
    const m = run(frame("d", [a, b], { layout: "VERTICAL" }));
    expect(m.blocks.map(plain)).toEqual(["A", "B"]);
  });
  it("free-form sorts top-to-bottom", () => {
    const m = run(frame("d", [text("c", [seg("C")], { y: 200 }), text("a", [seg("A")], { y: 0 }), text("b", [seg("B")], { y: 100 })]));
    expect(m.blocks.map(plain)).toEqual(["A", "B", "C"]);
  });
  it("same row (>50% y overlap) reads left-to-right, even if the right one is slightly higher", () => {
    const left = text("l", [seg("L")], { x: 0, y: 8, h: 20 });
    const right = text("r", [seg("R")], { x: 300, y: 0, h: 20 });
    const below = text("b", [seg("B")], { x: 0, y: 100 });
    const m = run(frame("d", [right, below, left]));
    expect(m.blocks.map(plain)).toEqual(["L", "R", "B"]);
  });
  it("<=50% overlap is a different row", () => {
    const top = text("t", [seg("T")], { x: 300, y: 0, h: 20 });
    const lower = text("l", [seg("L")], { x: 0, y: 10, h: 20 }); // overlap 10/20 = 0.5 -> not above 50%
    expect(orderChildren(frame("d", [lower, top])).map((n) => n.name)).toEqual(["t", "l"]);
  });
  it("zero-height node inside a row's span joins the row", () => {
    const t1 = text("t", [seg("T")], { x: 0, y: 0, h: 20 });
    const line = shape("line", { type: "LINE", x: 300, y: 10, h: 0 });
    expect(orderChildren(frame("d", [line, t1])).map((n) => n.name)).toEqual(["t", "line"]);
  });
});

describe("containers & skipping (rules 3, 5)", () => {
  it("recurses into transparent frames/groups/sections", () => {
    const stack = frame("stack", [text("a", [seg("A")]), text("b", [seg("B")], { y: 30 })], { layout: "VERTICAL", y: 0 });
    const grp = frame("grp", [text("c", [seg("C")])], { type: "GROUP", y: 100 });
    const sec = frame("sec", [text("d", [seg("D")])], { type: "SECTION", y: 200 });
    const m = run(frame("d", [sec, grp, stack]));
    expect(m.blocks.map(plain)).toEqual(["A", "B", "C", "D"]);
  });
  it("a container with a visible fill/stroke/effect becomes one image and is not descended", () => {
    const card = frame("Card", [text("inner", [seg("hidden in image")])], { paint: true });
    const m = run(frame("d", [card]));
    expect(m.blocks).toEqual([{ type: "image", alt: "Card", nodeId: card.id }]);
  });
  it("skips hidden nodes and names starting with _ (also inside containers)", () => {
    const m = run(
      frame("d", [
        text("keep", [seg("K")], { y: 0 }),
        text("hidden", [seg("H")], { y: 30, visible: false }),
        text("_note", [seg("N")], { y: 60 }),
        shape("_scribble", { y: 90 }),
        frame("_wip", [text("x", [seg("X")])], { y: 120 }),
        frame("wrap", [text("y", [seg("Y")]), text("_z", [seg("Z")], { y: 30 })], { y: 150 }),
        shape("hiddenShape", { y: 200, visible: false }),
      ]),
    );
    expect(m.blocks.map(plain)).toEqual(["K", "Y"]);
  });
  it("hidden transparent container is skipped entirely", () => {
    const m = run(frame("d", [frame("w", [text("t", [seg("T")])], { visible: false })]));
    expect(m.blocks).toEqual([]);
  });
});

describe("images (rule 4)", () => {
  it("instance, component, vector, rectangle all become images with node name as alt", () => {
    const kids = [
      shape("Primary button", { type: "INSTANCE", y: 0 }),
      shape("Icon", { type: "VECTOR", y: 50 }),
      shape("Hero", { type: "RECTANGLE", y: 100 }),
      shape("Comp", { type: "COMPONENT", y: 150 }),
      frame("Transparent component", [text("t", [seg("T")])], { type: "COMPONENT", y: 200 }),
    ];
    const m = run(frame("d", kids));
    expect(m.blocks.every((b) => b.type === "image")).toBe(true);
    expect(m.blocks.map(plain)).toEqual(["Primary button", "Icon", "Hero", "Comp", "Transparent component"]);
  });
  it("asset ids are file-safe even for nested instance ids", () => {
    const i = shape("x", { type: "INSTANCE" });
    i.id = "I12:346;1:2";
    const m = run(frame("d", [i]));
    expect(m.blocks[0]).toMatchObject({ nodeId: "I12:346;1:2" });
  });
});

describe("text: spans, paragraphs (rule 2)", () => {
  it("bold / italic / link / mono become spans", () => {
    const t = text("t", [
      seg("A "),
      seg("bold", { fontStyle: "Bold", fontWeight: 700 }),
      seg(" "),
      seg("it", { fontStyle: "Italic" }),
      seg(" "),
      seg("semi", { fontStyle: "SemiBold", fontWeight: 600 }),
      seg(" "),
      seg("link", { href: "https://x.y" }),
      seg(" "),
      seg("code", { fontFamily: "Atkinson Hyperlegible Mono" }),
      seg(" ", { fontFamily: "JetBrains Mono" }),
    ]);
    const m = run(frame("d", [t]));
    const spans = (m.blocks[0] as any).spans;
    expect(spans.find((s: any) => s.text === "bold")).toMatchObject({ bold: true });
    expect(spans.find((s: any) => s.text === "it")).toMatchObject({ italic: true });
    expect(spans.find((s: any) => s.text === "semi")).toMatchObject({ bold: true });
    expect(spans.find((s: any) => s.text === "link")).toMatchObject({ href: "https://x.y" });
    expect(spans.find((s: any) => s.text === "code")).toMatchObject({ code: true });
  });
  it("splits paragraphs on newlines and drops blank ones", () => {
    const m = run(frame("d", [text("t", [seg("one\n\ntwo\r\nthree\n")])]));
    expect(m.blocks.map(plain)).toEqual(["one", "two", "three"]);
  });
  it("a bold sentence in the middle of a paragraph keeps its span split across newline boundaries", () => {
    const m = run(frame("d", [text("t", [seg("a "), seg("b\nc", { fontWeight: 700, fontStyle: "Bold" })])]));
    expect(m.blocks.map(plain)).toEqual(["a b", "c"]);
    expect((m.blocks[1] as any).spans[0].bold).toBe(true);
  });
  it("whitespace-only text node yields nothing", () => {
    expect(run(frame("d", [text("t", [seg("  \n ")])])).blocks).toEqual([]);
  });
});

describe("lists", () => {
  it("one segment with three lines -> one unordered list of three items", () => {
    const m = run(frame("d", [text("t", [seg("a\nb\nc", { list: "UNORDERED" })])]));
    expect(m.blocks).toEqual([{ type: "list", ordered: false, items: [[{ text: "a" }], [{ text: "b" }], [{ text: "c" }]] }]);
  });
  it("ordered list; switching kind starts a new list; plain paragraph ends a list", () => {
    const m = run(
      frame("d", [
        text("t", [seg("1\n2\n", { list: "ORDERED" }), seg("x\ny\n", { list: "UNORDERED" }), seg("para\n"), seg("z", { list: "UNORDERED" })]),
      ]),
    );
    expect(m.blocks.map((b) => b.type)).toEqual(["list", "list", "paragraph", "list"]);
    expect((m.blocks[0] as any).ordered).toBe(true);
    expect((m.blocks[1] as any).ordered).toBe(false);
  });
  it("lists in separate text nodes stay separate", () => {
    const m = run(frame("d", [text("a", [seg("x", { list: "UNORDERED" })], { y: 0 }), text("b", [seg("y", { list: "UNORDERED" })], { y: 50 })]));
    expect(m.blocks.length).toBe(2);
  });
  it("nested items (indentation) are flattened", () => {
    const m = run(frame("d", [text("t", [seg("a\n", { list: "UNORDERED" }), seg("b", { list: "UNORDERED" })])]));
    expect((m.blocks[0] as any).items.length).toBe(2);
  });
  it("list-item rich text keeps spans", () => {
    const m = run(frame("d", [text("t", [seg("see ", { list: "UNORDERED" }), seg("this", { list: "UNORDERED", href: "https://a.b" })])]));
    expect((m.blocks[0] as any).items[0]).toEqual([{ text: "see " }, { text: "this", href: "https://a.b" }]);
  });
});

describe("headings", () => {
  it("falls back to font-size rank: largest=H1, next=H2, next=H3, body=paragraph", () => {
    const m = run(
      frame("d", [
        text("a", [seg("Title", { fontSize: 32 })], { y: 0 }),
        text("b", [seg("Section", { fontSize: 24 })], { y: 40 }),
        text("c", [seg("Sub", { fontSize: 20 })], { y: 80 }),
        text("d", [seg("Body text that is long enough to be the dominant size.")], { y: 120 }),
        text("e", [seg("small", { fontSize: 12 })], { y: 160 }),
      ]),
    );
    expect(m.blocks.map((b) => (b.type === "heading" ? `h${b.level}` : b.type))).toEqual(["heading", "heading", "heading", "paragraph", "paragraph"].map((_, i) => ["h1", "h2", "h3", "paragraph", "paragraph"][i]));
  });
  it("more than four larger sizes cap at H4", () => {
    const sizes = [60, 50, 40, 30, 24, 20];
    const m = run(frame("d", [...sizes.map((s, i) => text("t" + s, [seg("H" + s, { fontSize: s })], { y: i * 50 })), text("body", [seg("body body body body body body")], { y: 400 })]));
    expect(m.blocks.slice(0, 6).map((b) => (b as any).level)).toEqual([1, 2, 3, 4, 4, 4]);
  });
  it("no larger size than body -> all paragraphs", () => {
    const m = run(frame("d", [text("a", [seg("x", { fontSize: 14 })], { y: 0 }), text("b", [seg("yyyy", { fontSize: 14 })], { y: 40 })]));
    expect(m.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });
  it("body size is the most common size by characters", () => {
    const m = run(frame("d", [text("a", [seg("a very long body paragraph with many characters", { fontSize: 18 })], { y: 0 }), text("b", [seg("short", { fontSize: 14 })], { y: 40 })]));
    expect(m.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });
  it("text style names win over size", () => {
    const m = run(
      frame("d", [
        text("a", [seg("tiny but H1", { fontSize: 12, styleName: "Heading 1" })], { y: 0 }),
        text("b", [seg("Biggest but styled as body", { fontSize: 40, styleName: "Body/Regular" })], { y: 40 }),
        text("c", [seg("styled h3", { styleName: "Type/H3" })], { y: 80 }),
        text("d", [seg("title", { styleName: "Title" })], { y: 120 }),
        text("e", [seg("unknown style at body size", { styleName: "Brand/Fancy" })], { y: 160 }),
      ]),
    );
    expect(m.blocks.map((b) => (b.type === "heading" ? b.level : b.type))).toEqual([1, "paragraph", 3, 1, "paragraph"]);
  });
  it("unrecognised style falls back to size rank", () => {
    const m = run(frame("d", [text("a", [seg("Big", { fontSize: 30, styleName: "Brand/Fancy" })], { y: 0 }), text("b", [seg("body body body body")], { y: 50 })]));
    expect(m.blocks[0]).toMatchObject({ type: "heading", level: 1 });
  });
  it("levelFromStyleName", () => {
    expect(levelFromStyleName("H1")).toBe(1);
    expect(levelFromStyleName("Heading 2")).toBe(2);
    expect(levelFromStyleName("Text/Heading/H4")).toBe(4);
    expect(levelFromStyleName("H6")).toBe(4);
    expect(levelFromStyleName("Title")).toBe(1);
    expect(levelFromStyleName("Subtitle")).toBe(2);
    expect(levelFromStyleName("Body")).toBe("paragraph");
    expect(levelFromStyleName("Caption")).toBe("paragraph");
    expect(levelFromStyleName("H12")).toBeUndefined();
    expect(levelFromStyleName("Fancy")).toBeUndefined();
  });
  it("sizes in skipped/hidden text do not influence ranks", () => {
    const m = run(frame("d", [text("a", [seg("Body body body body")], { y: 0 }), text("_big", [seg("Huge", { fontSize: 90 })], { y: 40 }), text("b", [seg("Real title", { fontSize: 30 })], { y: 80 })]));
    expect(m.blocks[1]).toMatchObject({ type: "heading", level: 1 });
  });
});

describe("realistic doc (end to end through extract)", () => {
  it("title, intro, list, image row, section", () => {
    const m = run(
      frame("Buttons", [
        text("Title", [seg("Buttons", { fontSize: 32, fontStyle: "Bold", fontWeight: 700 })], { y: 0 }),
        text("Intro", [seg("Use buttons to trigger actions. See "), seg("guidelines", { href: "https://g.example" }), seg(".")], { y: 50 }),
        text("List", [seg("Primary\nSecondary", { list: "UNORDERED" })], { y: 100 }),
        shape("Primary", { type: "INSTANCE", x: 0, y: 150 }),
        shape("Secondary", { type: "INSTANCE", x: 220, y: 155 }),
        text("Sub", [seg("Usage", { fontSize: 24, fontStyle: "Bold", fontWeight: 700 })], { y: 250 }),
        text("Do", [seg("Always label buttons with verbs.")], { y: 290 }),
      ]),
    );
    expect(m.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "image", "image", "heading", "paragraph"]);
    expect((m.blocks[0] as any).level).toBe(1);
    expect((m.blocks[5] as any).level).toBe(2);
    expect(m.blocks.filter((b) => b.type === "image").map(plain)).toEqual(["Primary", "Secondary"]);
  });
});
