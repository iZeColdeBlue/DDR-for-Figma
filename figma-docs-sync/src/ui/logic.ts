// Pure UI logic (no DOM): repo links, effective config, error -> banner copy. Copy is from
// design/handover/reference/fail-*.html, word for word.
import type { FileConfig, UserConfig } from "../messages";
import { normalizeFolder } from "../paths";
import { BranchMovedError, GitHubError } from "../sync/github";

/** All external URLs in one place. The guide website isn't built yet, so guides point at GitHub's docs. */
export const LINKS = {
  signup: "https://github.com/signup",
  guideRepo: "https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository",
  guideToken:
    "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token",
  guideBranch:
    "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository",
  help: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  /** where the plugin's own code lives (not the docs repo) */
  source: "https://github.com/iZeColdeBlue/DDR-for-Figma",
} as const;

/** `https://github.com/owner/name`, `github.com/owner/name(.git)`, or `owner/name`. */
export function parseRepoLink(link: string): { owner: string; repo: string } | null {
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(link.trim());
  return m && m[2] !== "." && m[2] !== ".." ? { owner: m[1], repo: m[2] } : null;
}

export const repoLink = (owner: string, repo: string) => (owner && repo ? `github.com/${owner}/${repo}` : "");

/** Effective value = personal override if set, else the file value. */
export function effective(file: FileConfig, user: UserConfig): { branch: string; docsFolder: string } {
  return {
    branch: user.branchOverride.trim() || file.branch.trim(),
    docsFolder: normalizeFolder(user.folderOverride.trim() || file.docsFolder || "docs"),
  };
}

export const maskToken = (t: string, dots = 8) => (t ? "•".repeat(dots) + t.slice(-4) : "");

export const daysUntil = (d: Date, now = Date.now()) => Math.max(0, Math.ceil((d.getTime() - now) / 86_400_000));

export type BannerKind = "success" | "info" | "warning" | "error";
/** `href`: leaves the plugin (gets the ↗ arrow). `action`: in-plugin link. */
export type BannerLink = { label: string; href?: string; action?: string };
export type BannerModel = { kind: BannerKind; title: string; body: string; link?: BannerLink; dismiss?: string };

/** GitHub failure -> banner (fail-1 / fail-2 boards). Errors always name a next step. */
export function errorBanner(e: unknown): BannerModel {
  const tryAgain: BannerLink = { label: "Try again", action: "retry" };
  if (e instanceof BranchMovedError)
    return { kind: "error", title: "GitHub isn't responding", body: "The branch kept changing on GitHub. Please try syncing again.", link: tryAgain };
  if (!(e instanceof GitHubError))
    return { kind: "error", title: "Can't connect to repository", body: e instanceof Error ? e.message : String(e), link: { label: "How to fix common problems", href: LINKS.help } };
  switch (e.kind) {
    case "auth":
      return { kind: "error", title: "Token not accepted", body: "GitHub rejected this token. It may be mistyped or revoked.", link: { label: "Replace token", action: "replaceToken" } };
    case "notfound":
      return { kind: "error", title: "Can't find this repository", body: "Check the link, or add the repository to your token under Repository access.", link: { label: "How to fix", href: LINKS.help } };
    case "permission":
      return { kind: "error", title: "Token can read but not write", body: "Set Contents to Read and write on GitHub, then test again.", link: { label: "How to fix", href: LINKS.help } };
    case "approval":
      return { kind: "error", title: "Waiting for organisation approval", body: "An owner of your organisation must approve this token before it works." };
    case "network":
      return { kind: "error", title: "No connection", body: "Check your internet connection and try again.", link: tryAgain };
    case "ratelimit":
      return {
        kind: "error",
        title: "Too many requests",
        body: `GitHub asks you to wait. Try again in about ${e.retryMinutes ?? 1} minute${e.retryMinutes === 1 || !e.retryMinutes ? "" : "s"}.`,
      };
    case "protected":
      return { kind: "error", title: "This branch is protected", body: "GitHub blocks direct saves to it. Choose a separate branch.", link: { label: "Change branch", action: "changeBranch" } };
    default:
      if (e.status && e.status >= 500)
        return { kind: "error", title: "GitHub isn't responding", body: "This usually clears up within a few minutes.", link: tryAgain };
      return { kind: "error", title: "Can't connect to repository", body: e.message, link: { label: "How to fix common problems", href: LINKS.help } };
  }
}

export const archivedBanner: BannerModel = {
  kind: "error",
  title: "This repository is archived",
  body: "Archived repositories are read-only. Unarchive it on GitHub or pick another.",
  link: { label: "Open GitHub", href: "https://github.com" },
};

/** Warning when the token runs out within 7 days (fail-1 board). */
export function expiryBanner(expires: Date | undefined, now = Date.now()): BannerModel | null {
  if (!expires) return null;
  const days = daysUntil(expires, now);
  if (days > 7) return null;
  return {
    kind: "warning",
    title: `Token expires in ${days} day${days === 1 ? "" : "s"}`,
    body: "Renew it on GitHub, then replace it here, so syncing does not stop.",
    link: { label: "Open Settings", action: "openSettings" },
  };
}
