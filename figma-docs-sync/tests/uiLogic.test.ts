import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_CONFIG, DEFAULT_USER_CONFIG } from "../src/messages";
import { GitHubClient, GitHubError, BranchMovedError } from "../src/sync/github";
import { effective, errorBanner, expiryBanner, maskToken, parseRepoLink } from "../src/ui/logic";
import { FakeGitHub } from "./helpers/fakeGitHub";

describe("parseRepoLink", () => {
  it("accepts the usual link shapes", () => {
    for (const l of ["https://github.com/acme/docs", "github.com/acme/docs", "acme/docs", " https://www.github.com/acme/docs.git/ "])
      expect(parseRepoLink(l), l).toEqual({ owner: "acme", repo: "docs" });
  });
  it("rejects anything that is not a repo link", () => {
    for (const l of ["", "acme", "github.com/acme", "https://gitlab.com/acme/docs", "github.com/acme/docs/tree/main", "acme/.."])
      expect(parseRepoLink(l), l).toBeNull();
  });
});

describe("effective config", () => {
  const file = { ...DEFAULT_FILE_CONFIG, mode: "github" as const, branch: "design", docsFolder: "docs" };
  it("uses the file values when there is no override", () => {
    expect(effective(file, DEFAULT_USER_CONFIG)).toEqual({ branch: "design", docsFolder: "docs" });
  });
  it("personal overrides win and folders are normalised", () => {
    expect(effective(file, { ...DEFAULT_USER_CONFIG, branchOverride: "mine", folderOverride: "/team-a/x/" })).toEqual({ branch: "mine", docsFolder: "team-a/x" });
  });
});

describe("banners", () => {
  it("maps every GitHub failure to a titled banner that names a next step", () => {
    const kinds = ["auth", "notfound", "permission", "network", "protected"] as const;
    for (const k of kinds) {
      const b = errorBanner(new GitHubError("x", k));
      expect(b.kind).toBe("error");
      expect(b.title).toBeTruthy();
      expect(b.link, k).toBeDefined();
    }
    expect(errorBanner(new GitHubError("x", "other", 502)).title).toBe("GitHub isn't responding");
    expect(errorBanner(new GitHubError("x", "ratelimit", 403, 12)).body).toContain("about 12 minutes");
    expect(errorBanner(new BranchMovedError()).link?.action).toBe("retry");
  });
  it("warns only within 7 days of token expiry", () => {
    const now = Date.UTC(2026, 10, 27);
    expect(expiryBanner(new Date(now + 30 * 86400000), now)).toBeNull();
    expect(expiryBanner(new Date(now + 6 * 86400000), now)?.title).toBe("Token expires in 6 days");
    expect(expiryBanner(undefined, now)).toBeNull();
  });
  it("masks the token to the last 4", () => {
    expect(maskToken("github_pat_abcd3f2a")).toBe("••••••••3f2a");
  });
});

describe("GitHub connection test and branches", () => {
  const mk = (gh: FakeGitHub, branch = "", token = gh.token) => new GitHubClient({ owner: gh.owner, repo: gh.repo, branch, token, fetch: gh.fetch }, async () => {});
  it("checkRepo returns the default branch and proves write access with a blob", async () => {
    const gh = new FakeGitHub();
    expect(await mk(gh).checkRepo()).toEqual({ defaultBranch: "main", archived: false });
    expect(gh.log).toContain("POST /git/blobs");
  });
  it("checkRepo with a bad token is an auth error", async () => {
    await expect(mk(new FakeGitHub(), "", "nope").checkRepo()).rejects.toMatchObject({ kind: "auth" });
  });
  it("read-only status check does not write", async () => {
    const gh = new FakeGitHub();
    await mk(gh).checkRepo({ write: false });
    expect(gh.log.some((l) => l.startsWith("POST"))).toBe(false);
  });
  it("a missing branch is detected and created from the default branch", async () => {
    const gh = new FakeGitHub();
    const c = mk(gh, "design-docs");
    expect(await c.branchExists("design-docs")).toBe(false);
    await c.createBranch("main");
    expect(await c.branchExists("design-docs")).toBe(true);
  });
  it("reads the token expiry header", async () => {
    const gh = new FakeGitHub();
    const f: typeof fetch = async (u, i) => {
      const r = await gh.fetch(u, i);
      return new Response(await r.text(), { status: r.status, headers: { "github-authentication-token-expiration": "2027-01-01 12:00:00 UTC" } });
    };
    const c = new GitHubClient({ owner: gh.owner, repo: gh.repo, branch: "", token: gh.token, fetch: f });
    await c.checkRepo({ write: false });
    expect(c.tokenExpires?.toISOString()).toBe("2027-01-01T12:00:00.000Z");
  });
});
