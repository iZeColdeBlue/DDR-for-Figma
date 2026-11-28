// Shared UI components (design/handover HANDOFF §2). Plain DOM, styled by ui.css on the tokens.
import type { BannerModel } from "./logic";

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (k.startsWith("on")) (el as any)[k.toLowerCase()] = v;
    else if (k === "class") el.className = v;
    else if (k === "value") (el as any).value = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}

// ---------- icons (inline SVG from the screens, colour via currentColor) ----------
const PATHS = {
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  cloud: "M17.5 19a4.5 4.5 0 1 0-1.2-8.8A6 6 0 1 0 5 14.5 4 4 0 0 0 6.5 19z",
  arrow: "M5 12h14M12 5l7 7-7 7",
  external: "M7 17 17 7M7 7h10v10",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  success: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  warning: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  error: "M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM15 9l-6 6M9 9l6 6",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  chevron: "m9 18 6-6-6-6",
  plus: "M12 5v14M5 12h14",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  close: "M18 6 6 18M6 6l12 12",
} as const;
export type IconName = keyof typeof PATHS | "done" | "missing";

const NS = "http://www.w3.org/2000/svg";
export function icon(name: IconName, size = 16, stroke = 1.8, extraClass = ""): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true", class: `icon ${extraClass}`.trim() }))
    svg.setAttribute(k, String(v));
  if (name === "done" || name === "missing") {
    svg.innerHTML =
      name === "done"
        ? '<circle cx="12" cy="12" r="11" class="disc"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" class="tick" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 3"/>';
    return svg;
  }
  for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": stroke, "stroke-linecap": "round", "stroke-linejoin": "round" }))
    svg.setAttribute(k, String(v));
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", PATHS[name]);
  svg.append(p);
  return svg;
}

// ---------- buttons ----------
type BtnOpts = { onClick?: () => void; disabled?: boolean; busy?: boolean; id?: string; iconBefore?: IconName; iconAfter?: IconName };
function button(cls: string, label: string, o: BtnOpts = {}): HTMLButtonElement {
  const b = h(
    "button",
    {
      type: "button",
      class: `btn ${cls}`,
      id: o.id,
      // Disabled = aria-disabled + out of the tab order (HANDOFF §2), not the native attribute.
      "aria-disabled": o.disabled ? "true" : undefined,
      tabindex: o.disabled ? "-1" : undefined,
      "aria-busy": o.busy ? "true" : undefined,
    },
    o.iconBefore ? icon(o.iconBefore, 16, 1.8, o.busy && o.iconBefore === "refresh" ? "spin" : "") : null,
    label,
    o.iconAfter ? icon(o.iconAfter, 16, 2) : null,
  );
  b.onclick = () => {
    if (b.getAttribute("aria-disabled") === "true" || b.getAttribute("aria-busy") === "true") return;
    o.onClick?.();
  };
  return b;
}
export const primaryBtn = (label: string, o?: BtnOpts) => button("btn-primary", label, o);
export const secondaryBtn = (label: string, o?: BtnOpts) => button("btn-secondary", label, o);
export const inlineBtn = (label: string, o?: BtnOpts) => button("btn-inline", label, o);

/** Toggle the disabled look and behaviour of a primary button in place (keeps focus elsewhere intact). */
export function setDisabled(b: HTMLElement, disabled: boolean): void {
  if (disabled) {
    b.setAttribute("aria-disabled", "true");
    b.setAttribute("tabindex", "-1");
  } else {
    b.removeAttribute("aria-disabled");
    b.removeAttribute("tabindex");
  }
}

// ---------- links ----------
/** External link: opens the browser, gets the ↗ arrow. */
export const extLink = (label: string, href: string, small = false) =>
  h("a", { class: "link" + (small ? " sm" : ""), href, target: "_blank", rel: "noreferrer" }, h("span", {}, label), icon("external", 13, 1.8));
/** In-plugin link: no arrow. */
export const inLink = (label: string, onClick: () => void, small = false) =>
  h("button", { type: "button", class: "link" + (small ? " sm" : ""), onclick: onClick }, label);

// ---------- text field ----------
export type FieldOpts = {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
  type?: "text" | "password";
  required?: boolean;
  optional?: boolean;
  help?: Child;
  error?: string;
  onInput?: (v: string) => void;
};
export function field(o: FieldOpts): HTMLDivElement {
  const helpId = o.help ? o.id + "-help" : undefined;
  const errId = o.error ? o.id + "-err" : undefined;
  const input = h("input", {
    id: o.id,
    type: o.type ?? "text",
    value: o.value ?? "",
    placeholder: o.placeholder,
    required: o.required,
    "aria-required": o.required ? "true" : undefined,
    "aria-invalid": o.error ? "true" : undefined,
    "aria-describedby": [errId, helpId].filter(Boolean).join(" ") || undefined,
    autocomplete: "off",
    spellcheck: "false",
  });
  input.oninput = () => o.onInput?.(input.value);
  return h(
    "div",
    { class: "field" },
    h(
      "label",
      { for: o.id },
      o.label,
      o.required ? h("span", { class: "req", "aria-hidden": "true" }, "*") : null,
      o.optional && !o.required ? h("span", { class: "opt" }, "(optional)") : null,
    ),
    input,
    o.error ? h("div", { class: "field-error", id: errId }, icon("error", 14, 2), o.error) : null,
    o.help ? h("div", { class: "help", id: helpId }, o.help) : null,
  );
}

// ---------- banner ----------
const BANNER_ICON = { success: "success", info: "info", warning: "warning", error: "error" } as const;
export function banner(m: BannerModel, onAction: (action: string) => void, opts: { id?: string; titleId?: string } = {}): HTMLDivElement {
  const role = m.kind === "success" || m.kind === "info" ? "status" : "alert";
  return h(
    "div",
    { class: `banner ${m.kind}`, role, id: opts.id },
    h(
      "div",
      { class: "banner-strip" },
      icon(BANNER_ICON[m.kind], 16, 2),
      h("span", { class: "banner-title", id: opts.titleId }, m.title),
      m.dismiss
        ? h("button", { type: "button", class: "banner-close", "aria-label": `Dismiss: ${m.title}`, onclick: () => onAction(m.dismiss!) }, icon("close", 14, 2.2))
        : null,
    ),
    h(
      "div",
      { class: "banner-body" },
      h("div", {}, m.body),
      m.link ? (m.link.href ? extLink(m.link.label, m.link.href) : inLink(m.link.label, () => onAction(m.link!.action!))) : null,
    ),
  );
}

// ---------- notice dialog (banner as modal) ----------
export type DialogButton = { label: string; primary?: boolean; onClick: () => void };
/** Focus goes to the primary button, Tab is trapped, Esc = the first (dismiss) button. Returns a close function. */
export function dialog(m: { kind: BannerModel["kind"]; title: string; body: Child }, buttons: DialogButton[], restoreFocus?: () => void): () => void {
  const titleId = "dlg-title";
  const btns = buttons.map((b) => (b.primary ? primaryBtn : secondaryBtn)(b.label, { onClick: () => (close(), b.onClick()) }));
  const box = h(
    "div",
    { class: `banner ${m.kind}` },
    h("div", { class: "banner-strip" }, icon(BANNER_ICON[m.kind], 16, 2), h("span", { class: "banner-title", id: titleId }, m.title)),
    h("div", { class: "banner-body" }, h("div", {}, m.body), h("div", { class: "btn-row" }, ...btns)),
  );
  const scrim = h("div", { class: "scrim", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, box);
  const prev = document.activeElement as HTMLElement | null;
  scrim.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      btns[0].click();
    } else if (e.key === "Tab") {
      const f = [...scrim.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), a[href], input")];
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
      e.preventDefault();
      f[next].focus();
    }
  };
  document.body.append(scrim);
  (btns.find((_, i) => buttons[i].primary) ?? btns[0]).focus();
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    scrim.remove();
    if (restoreFocus) restoreFocus();
    else if (prev && document.contains(prev)) prev.focus();
    else document.querySelector<HTMLElement>(".tab[aria-current], h1")?.focus(); // trigger was re-rendered away
  }
  return close;
}

// ---------- headers ----------
export function progressHeader(n: number): HTMLDivElement {
  return h(
    "div",
    { class: "progress-hdr" },
    h("div", { class: "progress-row" }, h("span", { class: "label" }, "Setup progress"), h("span", { class: "label" }, `${n} / 4`)),
    h(
      "div",
      { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "4", "aria-valuenow": String(n), "aria-label": "Setup progress" },
      h("div", { class: "bar-fill", style: `width:${n * 25}%` }),
    ),
  );
}

export function tabs(active: "docs" | "settings", go: (t: "docs" | "settings") => void): HTMLDivElement {
  const tab = (t: "docs" | "settings", label: string) =>
    h("button", { type: "button", class: "tab", id: "tab-" + t, "aria-current": active === t ? "page" : undefined, onclick: () => go(t) }, label);
  return h("div", { class: "tabs-hdr" }, h("nav", { class: "tabs", "aria-label": "Sections" }, tab("docs", "Docs"), tab("settings", "Settings")));
}

/** `##` (screen) or `###` (setup step) heading. tabindex -1 so focus can move here after a screen change. */
export function heading(level: 1 | 2, text: string, optional = false): HTMLHeadingElement {
  return h(
    "h1",
    { class: level === 1 ? "h1" : "h2", tabindex: "-1" },
    h("span", { class: "marker", "aria-hidden": "true" }, level === 1 ? "## " : "### "),
    text,
    optional ? h("span", { class: "h-opt" }, "(optional)") : null,
  );
}

// ---------- status word ----------
export function statusWord(kind: "done" | "missing" | "warn" | "muted", text: string, iconName?: IconName): HTMLSpanElement {
  const ic = iconName ?? (kind === "done" ? "done" : "missing");
  return h("span", { class: "status " + kind }, icon(ic, 16, 2), h("span", { class: "label" + (kind === "done" ? " done" : kind === "warn" ? " warn" : "") }, text));
}

// ---------- key/value + tag ----------
export const kv = (label: string, value: string) => h("div", { class: "kv" }, h("span", { class: "label" }, label), h("span", { class: "kv-v" }, value));
export const tag = (text: string, accent = false) => h("span", { class: "tag" + (accent ? " accent" : "") }, text);

// ---------- guide layout ----------
export type GhRow = { label: string; value: string; ring?: boolean; badge?: number };
export function ghWindow(url: string, rows: GhRow[], button?: { label: string; ring?: boolean }, ariaLabel = `Schematic of the GitHub page: ${url}`): HTMLDivElement {
  return h(
    "div",
    { class: "ghwin", role: "img", "aria-label": ariaLabel },
    h("div", { class: "ghwin-bar" }, h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "ghwin-url" }, url)),
    h(
      "div",
      { class: "ghwin-body" },
      ...rows.map((r) =>
        h(
          "div",
          { class: "ghrow" },
          h("span", { class: "ghrow-l" }, r.label),
          h("span", { class: "ghfield" + (r.ring ? " ring" : "") }, r.value),
          r.badge ? h("span", { class: "badge" }, String(r.badge)) : null,
        ),
      ),
      button ? h("div", { class: "ghbtn-row" }, h("span", { class: "ghbtn" + (button.ring ? " ring" : "") }, button.label)) : null,
    ),
  );
}

export function steps(items: Child[], tight = false): HTMLOListElement {
  return h("ol", { class: "steps" + (tight ? " tight" : "") }, ...items.map((t, i) => h("li", {}, h("span", { class: "step-n", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")), h("span", {}, t))));
}

export const code = (s: string) => h("span", { class: "mono" }, s);

/** One screen: optional fixed header, scrolling body, optional fixed footer. */
export function screen(parts: { header?: Node; body: Child[]; bodyTop?: boolean; footer?: Child[] }): HTMLDivElement {
  return h(
    "div",
    { class: "screen" },
    parts.header ?? null,
    h("main", { class: "screen-body" + (parts.bodyTop ? " top" : "") }, ...parts.body),
    parts.footer ? h("footer", { class: "screen-footer" }, ...parts.footer) : null,
  );
}
