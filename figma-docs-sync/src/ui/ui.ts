// Plugin UI (runs in the iframe, which has `fetch`). Screens from design/handover (HANDOFF.md),
// plus the network + sync side: GitHub client, diff, statuses, zip download. No Figma API access here.
import { zipSync } from "fflate";
import {
  DEFAULT_FILE_CONFIG,
  DEFAULT_USER_CONFIG,
  type BuiltPayload,
  type DocInfo,
  type FileConfig,
  type MainToUI,
  type SelectionInfo,
  type UIToMain,
  type UserConfig,
} from "../messages";
import { normalizeFolder } from "../paths";
import { computeDiff, type DiffResult, type DocStatus } from "../sync/diff";
import { GitHubClient, GitHubError } from "../sync/github";
import { emptyManifest } from "../sync/manifest";
import { loadRemoteState, runSync, type RemoteState, type SyncDoc } from "../sync/sync";
import {
  banner,
  code,
  dialog,
  extLink,
  field,
  ghWindow,
  h,
  heading,
  icon,
  inLink,
  inlineBtn,
  kv,
  primaryBtn,
  progressHeader,
  screen,
  secondaryBtn,
  setDisabled,
  statusWord,
  steps,
  tabs,
  tag,
} from "./components";
import { LINKS, archivedBanner, daysUntil, effective, errorBanner, expiryBanner, maskToken, parseRepoLink, repoLink, type BannerModel } from "./logic";

type Route =
  | "loading" | "splash" | "choice" | "need" | "account" | "repo" | "token" | "connect" | "branch" | "saved"
  | "home" | "settings" | "fileSetUp" | "override";
type TestState = "untested" | "testing" | "ok" | "error";

const S = {
  route: "loading" as Route,
  file: { ...DEFAULT_FILE_CONFIG } as FileConfig,
  user: { ...DEFAULT_USER_CONFIG } as UserConfig,
  /** onboarding / "Change for everyone" draft; Back keeps it */
  draft: { link: "", token: "", folder: "docs", branch: "", branchSaved: false, branchGuide: "design-docs" },
  /** Connect came from Settings ("Change for everyone"), so Back returns there */
  fromSettings: false,
  test: "untested" as TestState,
  testBanners: [] as BannerModel[],
  linkError: "",
  tokenExpires: undefined as Date | undefined,
  /** last GitHub call with the token: true ok, false rejected, undefined unknown */
  tokenValid: undefined as boolean | undefined,
  defaultBranch: "",
  // 15 / Replace token
  replaceToken: false,
  newToken: "",
  tokenTest: "untested" as TestState,
  tokenBanner: null as BannerModel | null,
  // overrides form
  ovBranch: "",
  ovFolder: "",
  // home
  docs: [] as DocInfo[],
  built: [] as BuiltPayload[],
  remote: null as RemoteState | null,
  remoteBanner: null as BannerModel | null,
  branchMissing: false,
  diff: null as DiffResult | null,
  selection: null as SelectionInfo,
  busy: "",
  notice: null as BannerModel | null,
  overwrite: new Set<string>(),
  fileKey: undefined as string | undefined,
  fileId: "",
};
let pending: null | "status" | "sync" | "zip" = null;
let focusHeading = false;

const app = document.getElementById("app") as HTMLElement;
const send = (m: UIToMain) => parent.postMessage({ pluginMessage: m }, "*");

// ---------- config helpers ----------
const eff = () => effective(S.file, S.user);
const isLocal = () => S.file.mode !== "github";
const canSync = () => S.file.mode === "github" && !!(S.file.owner && S.file.repo && S.user.token);
const syncBranch = () => eff().branch || S.defaultBranch;
const client = (o: { owner: string; repo: string; token: string; branch?: string }) =>
  new GitHubClient({ owner: o.owner, repo: o.repo, branch: o.branch ?? "", token: o.token.trim() });
const fileClient = () => client({ owner: S.file.owner, repo: S.file.repo, token: S.user.token, branch: syncBranch() });

function saveFile(c: FileConfig) {
  S.file = c;
  send({ type: "saveFileConfig", config: c });
}
function saveUser(patch: Partial<UserConfig>) {
  S.user = { ...S.user, ...patch };
  send({ type: "saveUserConfig", config: S.user });
}

// ---------- navigation ----------
function go(r: Route) {
  S.route = r;
  focusHeading = true;
  render();
}

function entryCheck() {
  if (S.file.mode === "github") {
    if (S.user.token) {
      go("home");
      startBuild("status");
    } else go("fileSetUp");
    return;
  }
  if (S.file.mode === "local") {
    go("home");
    startBuild("status");
    if (!S.user.noticeDismissed) showLocalNotice();
    return;
  }
  go("splash");
}

function useLocal() {
  if (S.file.mode !== "github") saveFile({ ...S.file, mode: "local" });
  // The person who chose local mode doesn't need the teammate notice (19).
  saveUser({ noticeDismissed: true });
  go("home");
  startBuild("status");
}

function startSetup() {
  S.fromSettings = false;
  go("choice");
}

function showLocalNotice() {
  dialog(
    { kind: "info", title: "Sync is not set up", body: "Syncing is not set up in this file. Everything is saved locally on your computer." },
    [
      { label: "Dismiss", onClick: () => (saveUser({ noticeDismissed: true }), focusFirstTab()) },
      { label: "Set up sync", primary: true, onClick: startSetup },
    ],
    () => {},
  );
}
const focusFirstTab = () => document.getElementById("tab-docs")?.focus();

// ---------- render ----------
function render(): void {
  const focused = document.activeElement as HTMLInputElement | null;
  const focusId = focused?.id ?? "";
  const sel = focused && "selectionStart" in focused ? [focused.selectionStart, focused.selectionEnd] : null;
  const view = VIEWS[S.route]();
  app.replaceChildren(view);
  if (focusHeading) {
    focusHeading = false;
    const h1 = app.querySelector<HTMLElement>("h1");
    if (h1) h1.focus();
    else focusFirstTab();
    return;
  }
  if (focusId && !document.activeElement?.closest(".scrim")) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (sel && sel[0] !== null && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
    }
  }
}

const footerRow = (...btns: HTMLElement[]) => h("div", { class: "btn-row" }, ...btns);
const backBtn = (to: () => void, label = "Back") => secondaryBtn(label, { onClick: to });

/** Primary button that stays disabled while any of the required values is empty (trimmed). */
function guardedPrimary(label: string, required: () => string[], onClick: () => void, extra: Parameters<typeof primaryBtn>[1] = {}) {
  const b = primaryBtn(label, { ...extra, onClick, disabled: required().some((v) => !v.trim()) });
  const update = () => setDisabled(b, required().some((v) => !v.trim()) || !!extra.disabled);
  return { b, update };
}

function onBannerAction(a: string) {
  if (a === "retry") return S.route === "home" ? refresh() : undefined;
  if (a === "replaceToken") {
    // On Connect and screen 15 the token field is right there: go to it instead of the Replace token screen.
    const t = document.querySelector<HTMLInputElement>("#c-token, #fs-token");
    return t ? (t.focus(), t.select()) : openReplaceToken();
  }
  if (a === "openSettings") return go("settings");
  if (a === "changeBranch") return S.route === "connect" ? openBranchGuide() : go("settings");
  if (a === "dismissLocal") {
    saveUser({ localBannerDismissed: true });
    render();
    document.getElementById("mark-btn")?.focus();
  }
  if (a === "setupGitHub") return startSetup();
}

// ---------- 01 splash ----------
function vSplash() {
  return h(
    "div",
    { class: "screen" },
    h(
      "main",
      { class: "splash" },
      h("div", { class: "logo", role: "img", "aria-label": "Plugin logo (placeholder)" }, h("span", { "aria-hidden": "true" }, "##")),
      h("div", { class: "splash-text" }, heading(1, "Figma Docs Sync"), h("p", { class: "lead" }, "Turn frames into Markdown docs and keep them in step with your repository.")),
      h(
        "ul",
        { class: "features" },
        h("li", {}, icon("doc", 18, 1.7), "Mark any frame as a doc"),
        h("li", {}, icon("download", 18, 1.7), "Get it as a Markdown file"),
        h("li", {}, icon("cloud", 18, 1.7), "Sync every doc to GitHub"),
      ),
    ),
    h(
      "footer",
      { class: "splash-footer" },
      primaryBtn("Start setup", { onClick: startSetup, iconAfter: "arrow" }),
      h("button", { type: "button", class: "btn-text", onclick: useLocal }, "Skip setup"),
    ),
  );
}

// ---------- 02 storage choice ----------
function vChoice() {
  return screen({
    bodyTop: true,
    body: [
      heading(1, "Where should docs go?"),
      banner({ kind: "info", title: "GitHub only, for now", body: "Other sync options may follow later." }, onBannerAction),
      h(
        "div",
        { class: "card choice" },
        h("div", { class: "card-head" }, h("span", { class: "card-title" }, icon("cloud", 18, 1.7), h("h2", { class: "title3", style: "margin:0" }, "Save to GitHub")), tag("Recommended", true)),
        h("p", { class: "lead" }, "Docs sync to a repository you own, so nothing lives only in this Figma file."),
        primaryBtn("Set up GitHub sync", { onClick: () => go("need"), iconAfter: "arrow" }),
      ),
      h(
        "div",
        { class: "card choice" },
        h("span", { class: "card-title" }, icon("download", 18, 1.7), h("h2", { class: "title3", style: "margin:0" }, "Download only")),
        h("p", { class: "lead" }, "No account needed. Download your docs as .md files whenever you want."),
        secondaryBtn("Use without GitHub", { onClick: useLocal }),
      ),
    ],
  });
}

// ---------- 03 what you'll need ----------
function vNeed() {
  const item = (n: string, title: string, text: string) =>
    h("li", { class: "card need" }, h("span", { class: "need-n", "aria-hidden": "true" }, n), h("div", {}, h("h2", { class: "title3", style: "margin:0" }, title), h("p", { class: "lead" }, text)));
  return screen({
    bodyTop: true,
    body: [
      heading(1, "What you'll need"),
      h(
        "ol",
        { style: "margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px" },
        item("01", "A GitHub account", "A free home on github.com. It stores everything you sync."),
        item("02", "A repository", "A folder on GitHub that keeps every version of your docs. "),
        item("03", "An access token", "A password-like key. It lets this plugin write to your repository, and nothing else."),
      ),
    ],
    footer: [footerRow(backBtn(() => go("choice")), primaryBtn("Start with step 1", { onClick: () => go("account") }))],
  });
}

// ---------- 04 step 1 account ----------
function vAccount() {
  return screen({
    header: progressHeader(1),
    body: [
      heading(2, "Create a GitHub account"),
      h("p", { class: "lead" }, "GitHub is a website that stores your files and their history. A free account is enough."),
      ghWindow(
        "github.com/signup",
        [
          { label: "Email", value: "you@example.com", badge: 2 },
          { label: "Username", value: "your-name", ring: true },
          { label: "Password", value: "••••••••••" },
        ],
        { label: "Create account", ring: true },
      ),
      steps(["Open github.com/signup", "Enter an email, a password and a username", "Confirm the email GitHub sends you"]),
      extLink("Open github.com/signup", LINKS.signup),
    ],
    footer: [footerRow(backBtn(() => go("need")), primaryBtn("I have an account", { onClick: () => go("repo") }))],
  });
}

// ---------- 05 step 2 repository ----------
function vRepo() {
  const p = guardedPrimary("I added the repository", () => [S.draft.link], () => go("token"));
  return screen({
    header: progressHeader(2),
    body: [
      heading(2, "Create a repository"),
      h("p", { class: "lead" }, "A repository, or repo, is a folder on GitHub that keeps every version of your docs. Make it private if the docs are internal."),
      ghWindow(
        "github.com/new",
        [
          { label: "Repository name", value: "design-docs", ring: true, badge: 2 },
          { label: "Visibility", value: "◉ Private   ○ Public" },
        ],
        { label: "Create repository" },
      ),
      steps(["On GitHub, choose + then New repository", h("span", {}, "Name it, for example ", code("design-docs"), ", and create it"), "Copy the page address from your browser"]),
      extLink("Full guide with screenshots", LINKS.guideRepo),
    ],
    footer: [
      field({ id: "repo-link", label: "Repository link", required: true, value: S.draft.link, placeholder: "https://github.com/your-name/design-docs", onInput: (v) => ((S.draft.link = v), p.update()) }),
      footerRow(backBtn(() => go("account")), p.b),
    ],
  });
}

// ---------- 06 step 3 token ----------
function vToken() {
  const p = guardedPrimary("I added my token", () => [S.draft.token], () => go("connect"));
  return screen({
    header: progressHeader(3),
    body: [
      heading(2, "Create an access token"),
      h("p", { class: "lead" }, "The plugin needs a key to write to your repository. Create a fine-grained token that can only touch that repo."),
      ghWindow("github.com/settings/personal-access-tokens/new", [
        { label: "Token name", value: "Figma Docs Sync", badge: 1 },
        { label: "Repo access", value: "Only select repositories", ring: true, badge: 2 },
        { label: "Contents", value: "Read and write", ring: true, badge: 3 },
        { label: "Expiration", value: "90 days" },
      ]),
      steps(
        [
          "GitHub Settings, Developer settings, Fine-grained tokens, Generate new token",
          "Repository access: Only select repositories, then pick your repo",
          "Permissions: Contents, Read and write",
          "Generate the token and copy it. GitHub shows it only once.",
        ],
        true,
      ),
      extLink("Full guide with screenshots", LINKS.guideToken),
    ],
    footer: [
      field({ id: "token", label: "Fine-grained token", type: "password", required: true, value: S.draft.token, placeholder: "•••••••••••••••••••", onInput: (v) => ((S.draft.token = v), p.update()) }),
      footerRow(backBtn(() => go("repo")), p.b),
    ],
  });
}

// ---------- 07–10 step 4 connect ----------
function resetTest() {
  if (S.test === "untested" && !S.linkError) return;
  S.test = "untested";
  S.testBanners = [];
  S.linkError = "";
  render();
}

async function testConnection(): Promise<boolean> {
  if (S.test === "testing") return false;
  const parsed = parseRepoLink(S.draft.link);
  if (!parsed) {
    S.linkError = "That doesn't look like a repository link. Use github.com/owner/name.";
    S.test = "error";
    S.testBanners = [];
    render();
    document.getElementById("c-link")?.focus();
    return false;
  }
  S.linkError = "";
  S.test = "testing";
  render();
  const c = client({ ...parsed, token: S.draft.token });
  try {
    const info = await c.checkRepo();
    if (info.archived) {
      S.test = "error";
      S.testBanners = [{ ...archivedBanner, link: { label: "Open GitHub", href: `https://github.com/${parsed.owner}/${parsed.repo}` } }];
      return false;
    }
    S.defaultBranch = info.defaultBranch;
    S.tokenExpires = c.tokenExpires;
    S.tokenValid = true;
    const days = c.tokenExpires ? ` Token expires in ${daysUntil(c.tokenExpires)} days.` : "";
    S.testBanners = [{ kind: "success", title: "Connected", body: `Can read and write ${parsed.owner}/${parsed.repo}.${days}` }];
    const br = S.draft.branch.trim();
    if (br && !(await c.branchExists(br)))
      S.testBanners.push({ kind: "info", title: "Branch will be created", body: `${br} does not exist yet. It is created on your first sync.` });
    S.test = "ok";
    return true;
  } catch (e) {
    S.test = "error";
    if (e instanceof GitHubError && e.kind === "auth") S.tokenValid = false;
    S.testBanners = [errorBanner(e)];
    return false;
  } finally {
    render();
  }
}

async function continueFromConnect() {
  if (S.test !== "ok" && !(await testConnection())) return;
  const parsed = parseRepoLink(S.draft.link)!;
  saveFile({ mode: "github", owner: parsed.owner, repo: parsed.repo, branch: S.draft.branch.trim(), docsFolder: normalizeFolder(S.draft.folder) || "docs" });
  saveUser({ token: S.draft.token.trim() });
  go("saved");
}

function openBranchGuide() {
  S.draft.branchGuide = S.draft.branchSaved ? S.draft.branch : S.draft.branchGuide;
  go("branch");
}

function vConnect() {
  const testing = S.test === "testing";
  const cont = guardedPrimary("Continue", () => [S.draft.link, S.draft.token], continueFromConnect, { busy: testing });
  const changed = (k: "link" | "token" | "folder" | "branch") => (v: string) => {
    S.draft[k] = v;
    cont.update();
    resetTest();
  };
  return screen({
    header: progressHeader(4),
    body: [
      heading(2, "Test your connection"),
      h("p", { class: "lead" }, "It stays on this computer. It is never saved in the Figma file."),
      field({ id: "c-link", label: "Repository link", required: true, value: S.draft.link, error: S.linkError, onInput: changed("link") }),
      field({ id: "c-token", label: "Fine-grained token", type: "password", required: true, value: S.draft.token, onInput: changed("token") }),
      field({
        id: "c-folder",
        label: "Folder",
        optional: true,
        value: S.draft.folder,
        placeholder: "docs",
        help: "The folder in your repository where all docs are saved, so you can find them later.",
        onInput: changed("folder"),
      }),
      S.draft.branchSaved
        ? field({
            id: "c-branch",
            label: "Branch",
            optional: true,
            value: S.draft.branch,
            help: h("span", {}, "The branch your docs are saved on. ", inLink("More about branches", openBranchGuide, true)),
            onInput: changed("branch"),
          })
        : h(
            "button",
            { type: "button", class: "row-link", onclick: openBranchGuide },
            h("span", {}, icon("branch", 16, 1.7), h("span", { class: "row-link-t" }, "Set up a branch"), h("span", { class: "opt", style: "margin:0" }, "(optional)")),
            icon("chevron", 16, 1.7),
          ),
      h(
        "div",
        { class: "test-row" },
        inlineBtn(testing ? "Testing…" : "Test connection", { id: "c-test", iconBefore: "refresh", busy: testing, onClick: () => void testConnection() }),
      ),
      ...S.testBanners.map((b) => banner(b, onBannerAction)),
    ],
    footer: [footerRow(backBtn(() => go(S.fromSettings ? "settings" : "token")), cont.b)],
  });
}

// ---------- 11 branch guide ----------
function vBranch() {
  return screen({
    header: progressHeader(4),
    body: [
      heading(2, "Create a branch", true),
      h(
        "p",
        { class: "lead" },
        "A branch is a parallel copy of your repository. Docs saved on their own branch stay apart from other work until you merge them. If you work alone, skip this and docs go to the default branch.",
      ),
      ghWindow(
        (({ owner, repo }) => repoLink(owner, repo))(parseRepoLink(S.draft.link) ?? { owner: "your-name", repo: "design-docs" }),
        [
          { label: "Branch menu", value: "⎇ main ▾", ring: true, badge: 1 },
          { label: "New branch", value: "design-docs", ring: true, badge: 2 },
        ],
        { label: "Create branch" },
        "Schematic of the GitHub page: your repository, branch menu",
      ),
      steps([
        "Open your repository on GitHub and click the branch menu, it says main",
        h("span", {}, "Type a name, for example ", code("design-docs")),
        "Type the same name in the field below. Skipping GitHub is fine too: a new name is created on your first sync",
      ]),
      extLink("Full guide with screenshots", LINKS.guideBranch),
    ],
    footer: [
      field({
        id: "b-name",
        label: "Branch name",
        value: S.draft.branchGuide,
        placeholder: "design-docs",
        help: "Leave it empty to save to the default branch.",
        onInput: (v) => (S.draft.branchGuide = v),
      }),
      footerRow(
        backBtn(() => go("connect")),
        primaryBtn("Save branch", {
          onClick: () => {
            const v = S.draft.branchGuide.trim();
            if (v !== S.draft.branch.trim()) S.testBanners = S.testBanners.filter((b) => b.title !== "Branch will be created");
            S.draft.branch = v;
            S.draft.branchSaved = true;
            go("connect");
          },
        }),
      ),
    ],
  });
}

// ---------- 12 how it is saved ----------
function vSaved() {
  return screen({
    bodyTop: true,
    body: [
      heading(1, "How it is saved"),
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("span", { class: "card-title" }, icon("doc", 16, 1.7), h("h2", { class: "title3", style: "margin:0" }, "In this file")), tag("Shared")),
        kv("Repository", `${S.file.owner}/${S.file.repo}`),
        kv("Branch", S.file.branch || S.defaultBranch || "default"),
        kv("folder", S.file.docsFolder + "/"),
        h("p", { class: "lead" }, "Everyone who opens this file saves to the same repository."),
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("span", { class: "card-title" }, icon("lock", 16, 1.7), h("h2", { class: "title3", style: "margin:0" }, "On this computer")), tag("Only you")),
        kv("Access token", maskToken(S.user.token)),
        h("p", { class: "lead" }, "Never saved in the file. Teammates add their own token."),
      ),
      banner({ kind: "info", title: "Nothing is final", body: "Change any of this later in Settings.", link: { label: "Open Settings", action: "openSettings" } }, (a) => {
        if (a === "openSettings") {
          go("settings");
          startBuild("status");
        }
      }),
    ],
    footer: [
      footerRow(
        backBtn(() => go("connect")),
        primaryBtn("Done", {
          onClick: () => {
            go("home");
            startBuild("status");
          },
        }),
      ),
    ],
  });
}

// ---------- 13 / 17 home ----------
function vHome() {
  return h("div", { class: "screen" }, tabs("docs", switchTab), h("main", { class: "screen-body" }, ...homeBody()), h("footer", { class: "screen-footer" }, homeFooter()));
}

function switchTab(t: "docs" | "settings") {
  S.route = t === "docs" ? "home" : "settings";
  render();
  document.getElementById("tab-" + t)?.focus();
}

function homeBody(): Node[] {
  const out: Node[] = [];
  const local = isLocal();
  if (S.notice) out.push(banner({ ...S.notice, dismiss: "dismissNotice" }, (a) => (a === "dismissNotice" ? ((S.notice = null), render()) : onBannerAction(a))));
  if (local) {
    if (!S.user.localBannerDismissed)
      out.push(banner({ kind: "info", title: "Local mode", body: "Docs are not synced. Download .zip saves all .md files to your Downloads folder.", dismiss: "dismissLocal" }, onBannerAction));
  } else {
    const e = eff();
    out.push(
      h(
        "div",
        { class: "card saves-to" },
        h(
          "div",
          {},
          h("span", { class: "label" }, "This file saves to"),
          h("span", { class: "saves-repo" }, icon("book", 14, 1.7), `${S.file.owner}/${S.file.repo}`),
          h("span", { class: "saves-sub" }, `${e.branch || S.defaultBranch || "default branch"} · ${e.docsFolder}/`),
        ),
        inLink("Settings", () => go("settings")),
      ),
    );
    if (!S.user.token)
      out.push(banner({ kind: "info", title: "Add your token to sync", body: "Your token is personal and stays on this computer.", link: { label: "Add token", action: "replaceToken" } }, onBannerAction));
    if (S.remoteBanner) out.push(banner(S.remoteBanner, onBannerAction));
    const exp = expiryBanner(S.tokenExpires);
    if (exp) out.push(banner(exp, onBannerAction));
    if (S.branchMissing) out.push(banner({ kind: "info", title: "Branch will be created", body: `${syncBranch()} does not exist yet. It is created on your first sync.` }, onBannerAction));
  }

  const sel = S.selection;
  const hint = sel ? (sel.docId ? `“${sel.name}” is a doc` : sel.markable ? `Selected: ${sel.name}` : `Can’t mark a ${sel.type.toLowerCase()}`) : "Select a frame to mark it";
  out.push(
    h(
      "div",
      { class: "mark-row" },
      h(
        "button",
        {
          type: "button",
          id: "mark-btn",
          class: "btn btn-inline",
          "aria-describedby": "mark-hint",
          onclick: () => sel?.markable && !S.busy && send({ type: "mark" }),
        },
        icon("plus", 16, 1.8),
        "Mark as doc",
      ),
      h("div", { class: "small", id: "mark-hint" }, hint),
    ),
  );

  out.push(
    h(
      "div",
      { class: "list-head" },
      h("h2", { class: "title3", style: "margin:0" }, `Docs (${S.docs.length})`),
      local ? null : inLink("Refresh", refresh),
    ),
  );
  out.push(h("div", { class: S.busy ? "small" : "sr-only", role: "status" }, S.busy || ""));
  if (!S.docs.length) out.push(h("p", { class: "lead" }, "No docs yet. Select a frame and choose Mark as doc."));
  for (const d of S.docs) out.push(docCard(d));
  for (const o of S.diff?.orphans ?? []) {
    if (!o.removed.length && !o.conflicts.length) continue;
    const card = h("div", { class: "card doc" }, h("div", { class: "doc-head" }, h("div", {}, h("div", { class: "doc-name" }, o.path.split("/").pop() ?? o.path)), statusWord("muted", "Missing")));
    if (o.removed.length)
      card.append(banner({ kind: "warning", title: "Frame is gone", body: `Its frame no longer exists. ${plural(o.removed.length, "file")} will be deleted on the next sync, after you confirm.` }, onBannerAction));
    if (o.conflicts.length) card.append(banner({ kind: "warning", title: `${plural(o.conflicts.length, "file")} edited in GitHub`, body: "It will be kept." }, onBannerAction));
    out.push(card);
  }
  if (local) out.push(h("div", { class: "cta" }, h("span", {}, "Want automatic sync?"), inLink("Set up GitHub", startSetup)));
  return out;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function docStatus(d: DocInfo): Node | null {
  if (isLocal()) return S.built.some((b) => b.docId === d.docId) ? statusWord("done", "Done") : null;
  const st: DocStatus | undefined = S.diff?.docs.find((x) => x.docId === d.docId)?.status;
  if (st === "up to date") return statusWord("done", "Done");
  if (st === "new") return statusWord("muted", "Not synced");
  if (st === "changed") return statusWord("muted", "Changed");
  if (st === "conflict") return statusWord("warn", "Conflict", "warning");
  return null;
}

function docCard(d: DocInfo): Node {
  const card = h(
    "div",
    { class: "card doc" },
    h(
      "div",
      { class: "doc-head" },
      h(
        "div",
        {},
        h("button", { type: "button", class: "doc-name", title: "Show in Figma", onclick: () => send({ type: "focus", docId: d.docId }) }, d.relPath.split("/").pop() ?? d.relPath),
        h("div", { class: "small" }, `Frame: ${d.page} / ${d.name}`),
      ),
      docStatus(d),
    ),
  );
  if (d.duplicate)
    card.append(
      banner(
        { kind: "warning", title: "Duplicate frame", body: "This frame has the same doc ID as another frame. Give it a new ID before syncing.", link: { label: "Assign new ID", action: "reId" } },
        () => send({ type: "reId", docId: d.docId }),
      ),
    );
  for (const w of S.built.find((b) => b.docId === d.docId)?.warnings ?? []) card.append(h("div", { class: "small" }, w));
  const dd = S.diff?.docs.find((x) => x.docId === d.docId);
  if (dd?.status === "conflict") {
    card.append(
      banner(
        {
          kind: "warning",
          title: `${plural(dd.conflicts.length, "file")} edited in GitHub`,
          body: "It stays as it is. Sync will not overwrite your changes.",
          link: { label: "Overwrite with Figma version", action: "overwrite" },
        },
        () => void confirmOverwrite(d, dd.conflicts),
      ),
    );
  } else if (S.overwrite.has(d.docId)) {
    card.append(banner({ kind: "info", title: "Will be overwritten", body: "Figma’s version replaces the GitHub edits on the next sync.", link: { label: "Undo", action: "undo" } }, () => {
      S.overwrite.delete(d.docId);
      recomputeDiff();
      render();
    }));
  }
  return card;
}

function homeFooter(): Node {
  const busy = !!S.busy;
  const zip = () => startBuild("zip");
  if (isLocal())
    return footerRow(secondaryBtn("Refresh", { onClick: refresh, iconBefore: "refresh", busy }), primaryBtn("Download .zip", { onClick: zip, iconAfter: "download", busy }));
  return footerRow(secondaryBtn("Download .zip", { onClick: zip, iconBefore: "download", busy }), primaryBtn("Sync", { onClick: trySync, iconAfter: "refresh", busy, disabled: !canSync() }));
}

// ---------- 14 settings ----------
function vSettings() {
  return h("div", { class: "screen" }, tabs("settings", switchTab), h("main", { class: "screen-body" }, ...settingsBody()));
}

function settingsBody(): Node[] {
  if (isLocal())
    return [
      banner(
        { kind: "info", title: "Local mode", body: "Docs are not synced. Download them as .md files when you need them.", link: { label: "Set up GitHub", action: "setupGitHub" } },
        onBannerAction,
      ),
      openSource(),
    ];
  const tokenStatus =
    S.tokenValid === true ? statusWord("done", "Valid") : S.tokenValid === false ? statusWord("warn", "Not accepted", "warning") : S.user.token ? null : statusWord("muted", "Missing");
  return [
    h("h2", { class: "label", style: "margin:0" }, "This file · shared"),
    h(
      "div",
      { class: "card" },
      kv("Repository", `${S.file.owner}/${S.file.repo}`),
      kv("Branch", S.file.branch || S.defaultBranch || "default"),
      kv("Docs folder", S.file.docsFolder + "/"),
      h("div", {}, inlineBtn("Change for everyone", { iconBefore: "folder", onClick: changeForEveryone })),
      h("div", { class: "small" }, "Saved in the Figma file. Everyone who opens it saves here."),
    ),
    h("h2", { class: "label", style: "margin:0" }, "On this computer · only you"),
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("span", { class: "card-title" }, icon("key", 16, 1.7), h("h3", { class: "title3", style: "margin:0" }, "Default token")), tokenStatus),
      kv("Token", maskToken(S.user.token, 12) || "not set"),
      S.tokenExpires ? kv("Expires", `in ${daysUntil(S.tokenExpires)} days`) : null,
      h("div", {}, inlineBtn("Replace token", { iconBefore: "key", onClick: openReplaceToken })),
      h("div", { class: "small" }, "One token can cover several repositories. Add this repo to it on GitHub if it is missing."),
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-head" }, h("h3", { class: "title3", style: "margin:0" }, "Your overrides"), tag("Only you")),
      kv("Branch", S.user.branchOverride || "not set"),
      kv("Docs folder", S.user.folderOverride || "not set"),
      h("div", {}, inlineBtn("Override for me", { iconBefore: "branch", onClick: openOverrides })),
      h("div", { class: "small" }, "Save somewhere else without changing it for your team."),
    ),
    banner({ kind: "info", title: "Saved per file", body: "The repository is saved in the file. Your token and overrides stay on this computer." }, onBannerAction),
    openSource(),
  ];
}

/** Not in the design: credit line at the end of Settings, links the plugin's own code. */
function openSource() {
  return h("p", { class: "small" }, "This plugin is open source. Want to help? ", extLink("See the code on GitHub", LINKS.source, true));
}

function changeForEveryone() {
  S.draft = {
    link: repoLink(S.file.owner, S.file.repo),
    token: S.user.token,
    folder: S.file.docsFolder,
    branch: S.file.branch,
    branchSaved: !!S.file.branch,
    branchGuide: S.file.branch || "design-docs",
  };
  S.test = "untested";
  S.testBanners = [];
  S.linkError = "";
  S.fromSettings = true;
  go("connect");
}

function openOverrides() {
  S.ovBranch = S.user.branchOverride;
  S.ovFolder = S.user.folderOverride;
  go("override");
}

/** Not in the design: the personal override form behind "Override for me" (14). */
function vOverride() {
  return screen({
    bodyTop: true,
    body: [
      heading(2, "Your overrides"),
      h("p", { class: "lead" }, "Save somewhere else without changing it for your team."),
      field({ id: "ov-branch", label: "Branch", optional: true, value: S.ovBranch, placeholder: S.file.branch || S.defaultBranch || "main", onInput: (v) => (S.ovBranch = v) }),
      field({ id: "ov-folder", label: "Docs folder", optional: true, value: S.ovFolder, placeholder: S.file.docsFolder, onInput: (v) => (S.ovFolder = v) }),
    ],
    footer: [
      footerRow(
        backBtn(() => go("settings")),
        primaryBtn("Save", {
          onClick: () => {
            saveUser({ branchOverride: S.ovBranch.trim(), folderOverride: normalizeFolder(S.ovFolder) });
            go("settings");
            startBuild("status");
          },
        }),
      ),
    ],
  });
}

// ---------- 15 file already set up / replace token ----------
function openReplaceToken() {
  S.replaceToken = S.route === "settings"; // where Skip / success return to
  S.newToken = "";
  S.tokenTest = "untested";
  S.tokenBanner = null;
  go("fileSetUp");
}

async function saveAndTestToken() {
  S.tokenTest = "testing";
  S.tokenBanner = null;
  render();
  const c = client({ owner: S.file.owner, repo: S.file.repo, token: S.newToken });
  try {
    const info = await c.checkRepo();
    S.defaultBranch = info.defaultBranch;
    S.tokenExpires = c.tokenExpires;
    S.tokenValid = true;
    saveUser({ token: S.newToken.trim() });
    S.notice = { kind: "success", title: "Token saved", body: "Stored on this computer only." };
    S.tokenTest = "ok";
    go(S.replaceToken ? "settings" : "home");
    startBuild("status");
  } catch (e) {
    S.tokenTest = "error";
    S.tokenBanner = errorBanner(e);
    render();
  }
}

function vFileSetUp() {
  const testing = S.tokenTest === "testing";
  const p = guardedPrimary("Save and test token", () => [S.newToken], () => void saveAndTestToken(), { busy: testing });
  const repo = `${S.file.owner}/${S.file.repo}`;
  return h(
    "div",
    { class: "screen" },
    h("div", { class: "tabs-hdr" }, heading(1, "This file is set up")),
    h(
      "main",
      { class: "screen-body" },
      h("p", { class: "lead" }, "Someone already connected this file to GitHub. Your token is personal and stays on this computer, so add yours to start syncing."),
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-head" }, h("span", { class: "label" }, "Saved in this file"), tag("Shared")),
        kv("Repository", repo),
        kv("Branch", S.file.branch || "default"),
        kv("Docs folder", S.file.docsFolder + "/"),
      ),
      h("div", { class: "card-head" }, h("span", { class: "label" }, "Your token"), S.user.token ? statusWord("done", "On this computer") : statusWord("muted", "Not on this computer")),
      field({
        id: "fs-token",
        label: "Fine-grained token",
        type: "password",
        required: true,
        value: S.newToken,
        placeholder: "github_pat_…",
        help: `Needs Contents: Read and write on ${repo}.`,
        onInput: (v) => {
          S.newToken = v;
          p.update();
        },
      }),
      extLink("How do I create a token?", LINKS.guideToken),
      S.tokenBanner ? banner(S.tokenBanner, onBannerAction) : null,
      banner({ kind: "info", title: "Already have a token?", body: "Add this repository to it on GitHub instead of creating a new one." }, onBannerAction),
    ),
    h(
      "footer",
      { class: "screen-footer" },
      footerRow(
        backBtn(() => {
          go(S.replaceToken ? "settings" : "home");
          if (!S.replaceToken) startBuild("status");
        }, "Skip for now"),
        p.b,
      ),
    ),
  );
}

const VIEWS: Record<Route, () => Node> = {
  loading: () => h("div", { class: "screen" }),
  splash: vSplash,
  choice: vChoice,
  need: vNeed,
  account: vAccount,
  repo: vRepo,
  token: vToken,
  connect: vConnect,
  branch: vBranch,
  saved: vSaved,
  home: vHome,
  settings: vSettings,
  fileSetUp: vFileSetUp,
  override: vOverride,
};

// ---------- sync side ----------
function desired(): SyncDoc[] {
  return S.built.map((b) => {
    const files: Record<string, string> = {};
    const bytes: Record<string, Uint8Array> = {};
    for (const f of b.files) {
      files[f.path] = f.sha;
      bytes[f.path] = f.bytes;
    }
    return { docId: b.docId, path: b.path, nodeId: b.nodeId, files, bytes };
  });
}

function recomputeDiff(): void {
  S.diff = null;
  if (!S.built.length && !S.remote) return;
  if (!canSync()) return; // without GitHub there is nothing to compare against
  try {
    S.diff = computeDiff({
      docs: desired(),
      manifest: S.remote?.manifest ?? emptyManifest(),
      remote: S.remote?.remote ?? {},
      overwrite: S.overwrite,
      confirmDeletes: false,
      fileKey: S.fileKey,
      fileId: S.fileId,
    });
  } catch (e) {
    S.notice = errorBanner(e);
  }
}

async function fetchRemote(): Promise<void> {
  S.remote = null;
  S.remoteBanner = null;
  S.branchMissing = false;
  if (!canSync()) return;
  try {
    if (!S.defaultBranch) {
      const info = await client({ owner: S.file.owner, repo: S.file.repo, token: S.user.token }).checkRepo({ write: false });
      S.defaultBranch = info.defaultBranch;
      if (info.archived) S.remoteBanner = { ...archivedBanner, link: { label: "Open GitHub", href: `https://github.com/${S.file.owner}/${S.file.repo}` } };
    }
    const c = fileClient();
    if (eff().branch && !(await c.branchExists(eff().branch))) {
      S.branchMissing = true;
    } else {
      S.remote = await loadRemoteState(c, eff().docsFolder);
    }
    S.tokenExpires = c.tokenExpires ?? S.tokenExpires;
    S.tokenValid = true;
  } catch (e) {
    if (e instanceof GitHubError && e.kind === "auth") S.tokenValid = false;
    S.remoteBanner = errorBanner(e);
  }
}

function startBuild(why: "status" | "sync" | "zip"): void {
  if (S.busy) return;
  pending = why;
  S.busy = why === "zip" ? "Preparing zip…" : "Converting docs…";
  if (why !== "status") S.notice = null;
  render();
  send({ type: "build", docsFolder: eff().docsFolder });
}

function refresh() {
  S.notice = null;
  send({ type: "listDocs" });
  startBuild("status");
}

async function onBuilt(docs: BuiltPayload[], fileKey: string | undefined): Promise<void> {
  S.built = docs;
  S.fileKey = fileKey;
  const why = pending;
  pending = null;
  try {
    if (why === "zip") return await downloadZip();
    if (why === "sync") return await doSync();
    if (canSync()) {
      S.busy = "Checking GitHub…";
      render();
      await fetchRemote();
    }
    recomputeDiff();
  } catch (e) {
    S.notice = errorBanner(e);
  } finally {
    S.busy = "";
    render();
  }
}

function trySync(): void {
  if (S.docs.some((d) => d.duplicate)) {
    S.notice = { kind: "error", title: "Duplicate frames", body: "Some frames have the same doc ID. Assign them new IDs, then sync again." };
    return render();
  }
  startBuild("sync");
}

async function doSync(): Promise<void> {
  const docs = desired();
  const progress = (t: string) => {
    S.busy = t;
    render();
  };
  const c = fileClient();
  const folder = eff().docsFolder;
  try {
    if (eff().branch && !(await c.branchExists(eff().branch))) {
      progress("Creating branch…");
      if (!S.defaultBranch) S.defaultBranch = (await c.checkRepo({ write: false })).defaultBranch;
      await c.createBranch(S.defaultBranch);
    }
    let outcome = await runSync({ client: c, docsFolder: folder, docs, overwrite: S.overwrite, fileKey: S.fileKey, fileId: S.fileId, deletes: "ask", onProgress: progress });
    if (outcome.kind === "needs-confirmation") {
      const files = outcome.diff.pendingDeletes.map((d) => d.path);
      const choice = await confirmDeletes(files);
      if (choice === "cancel") {
        S.notice = { kind: "info", title: "Sync cancelled", body: "Nothing was changed." };
        await fetchRemote();
        recomputeDiff();
        return;
      }
      outcome = await runSync({ client: c, docsFolder: folder, docs, overwrite: S.overwrite, fileKey: S.fileKey, fileId: S.fileId, deletes: choice, onProgress: progress });
    }
    const skipped = outcome.diff.docs.filter((d) => d.status === "conflict").length;
    const skippedNote = skipped ? ` ${plural(skipped, "doc")} with GitHub edits ${skipped === 1 ? "was" : "were"} skipped.` : "";
    if (outcome.kind === "committed") {
      const docsDone = outcome.diff.docs.filter((d) => d.status === "new" || d.status === "changed").length;
      const title = docsDone ? `${plural(docsDone, "doc")} synced` : `${plural(outcome.diff.counts.removed, "file")} removed`;
      S.notice = { kind: "success", title, body: `Saved to ${syncBranch()} just now.${skippedNote}`, link: { label: "View on GitHub", href: outcome.commit.url } };
      S.overwrite.clear();
    } else if (outcome.kind === "up-to-date") {
      S.notice = { kind: "success", title: "Up to date", body: `Nothing to sync. No commit was made.${skippedNote}` };
    }
  } catch (e) {
    S.notice = errorBanner(e);
  }
  progress("Refreshing status…");
  await fetchRemote();
  recomputeDiff();
}

function confirmDeletes(files: string[]): Promise<"cancel" | "no" | "yes"> {
  return new Promise((resolve) =>
    dialog(
      {
        kind: "warning",
        title: `${plural(files.length, "file")} will be deleted`,
        body: h("div", {}, h("p", {}, "Their frames no longer exist. You confirm before sync removes them."), h("ul", { class: "files" }, ...files.map((p) => h("li", {}, p)))),
      },
      [
        { label: "Cancel sync", onClick: () => resolve("cancel") },
        { label: "Keep files", onClick: () => resolve("no") },
        { label: `Delete ${plural(files.length, "file")}`, primary: true, onClick: () => resolve("yes") },
      ],
    ),
  );
}

function confirmOverwrite(d: DocInfo, files: string[]): Promise<void> {
  return new Promise((resolve) =>
    dialog(
      {
        kind: "warning",
        title: "Overwrite GitHub edits?",
        body: h("div", {}, h("p", {}, `On the next sync, Figma’s version of “${d.name}” replaces these files:`), h("ul", { class: "files" }, ...files.map((p) => h("li", {}, p)))),
      },
      [
        { label: "Cancel", onClick: () => resolve() },
        {
          label: "Overwrite on next sync",
          primary: true,
          onClick: () => {
            S.overwrite.add(d.docId);
            recomputeDiff();
            render();
            resolve();
          },
        },
      ],
    ),
  );
}

async function downloadZip(): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const b of S.built) for (const f of b.files) entries[f.path] = f.bytes;
  if (!Object.keys(entries).length) {
    S.notice = { kind: "info", title: "Nothing to download", body: "Mark a frame as a doc first." };
    return;
  }
  const zip = zipSync(entries, { level: 6 });
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // after the download has started
  const a = h("a", { href: url, download: "figma-docs.zip" });
  document.body.append(a);
  a.click();
  a.remove();
  const md = S.built.length;
  S.notice = { kind: "success", title: "Download ready", body: `Your .zip with ${plural(md, "Markdown file")} is ready.` };
}

// ---------- wiring ----------
let initialDocs = true;
window.onmessage = (ev: MessageEvent) => {
  const m = ev.data?.pluginMessage as MainToUI | undefined;
  if (!m) return;
  switch (m.type) {
    case "config":
      S.file = { ...DEFAULT_FILE_CONFIG, ...m.file };
      S.user = { ...DEFAULT_USER_CONFIG, ...m.user };
      S.fileId = m.fileId;
      return entryCheck();
    case "docs": {
      S.docs = m.docs;
      if (initialDocs) initialDocs = false;
      else if (!S.busy && (S.route === "home" || S.route === "settings")) {
        const sig = (xs: { docId: string; relPath: string }[]) => xs.map((x) => x.docId + "|" + x.relPath).sort().join(",");
        if (sig(S.docs.filter((d) => !d.duplicate)) !== sig(S.built)) startBuild("status");
        else recomputeDiff();
      }
      if (S.route === "home") render();
      return;
    }
    case "selection":
      S.selection = m.selection;
      if (S.route === "home") render();
      return;
    case "progress":
      S.busy = m.text;
      if (S.route === "home") render();
      return;
    case "built":
      void onBuilt(m.docs, m.fileKey);
      return;
    case "error":
      if (m.build) {
        S.busy = "";
        pending = null;
      }
      S.notice = { kind: "error", title: "Something went wrong", body: m.message };
      if (S.route === "home") render();
      return;
  }
};

render();
send({ type: "init" });
