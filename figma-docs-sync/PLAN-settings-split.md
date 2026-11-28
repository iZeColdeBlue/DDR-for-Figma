# Plan: settings split (per user vs. per Figma file)

Status: agreed, not built yet. Date: 2026-11-27.

## Goal

The plugin should work when several people share one Figma file. Everyone in a file
syncs to the same repo, branch and folders. The only thing each person brings is
their own GitHub token.

## The split

| Setting | Stored | Where in Figma | Why |
|---|---|---|---|
| GitHub token | per user | `figma.clientStorage` | Personal secret. It acts as that user on GitHub. Must never go into the file, where everyone with file access could read it. |
| Repo link | per file | `figma.root` plugin data | Everyone in a shared file syncs to the same repo. |
| Branch (advanced) | per file | `figma.root` plugin data | Same reason: otherwise docs split across branches. Defaults to the repo's default branch. |
| Parent folder | per file | `figma.root` plugin data | e.g. `design/handovers`. All projects of this file sit under it. |
| Projects | per file | `figma.root` plugin data | name, description, folder. Docs land in `<parent>/<project folder>/`. |
| Figma URL | dropped from onboarding | (fallback only) | Only needed when `figma.fileKey` is unavailable. Show it only then. |

Anyone with edit access to the file can change the per-file settings for everyone.
That's accepted: they can change the file itself anyway.

## Personal overrides

The file settings are the default for everyone. Each user can override, for themselves
only (stored in `figma.clientStorage`, keyed by file):

- **Branch override**: sync to my own branch instead of the file's branch.
- **Folder override**: sync to my own folder instead of the file's folder.
  Example: different teams in the same file each keep their own folder.
  The override **replaces** the file's folder: it is a full repo path and can point
  anywhere in the repo (e.g. `team-a/handovers`), not a subfolder of the file's folder.
  Prefill the override field with the file's folder so people edit from the default.

Empty override = use the file setting. The file settings themselves stay in the file.

UI layout:
- **My settings** (easy to reach): token, branch override, folder override.
- **File settings** (tucked away, "advanced"): repo link, branch, parent folder, projects.
  Changing these affects everyone in the file.

Subfolders: any folder field accepts `a/b/c`. GitHub creates the folders on the first
commit. Leading/trailing slashes are stripped.

## Changes

1. **Repo link parsing.** One field: `https://github.com/owner/repo`. Parse it into
   owner and repo. Reject anything that isn't a github.com repo link.
2. **Default branch lookup.** `GET /repos/{owner}/{repo}` returns `default_branch`.
   Use it when no branch is set.
3. **Storage split.** The token stays in clientStorage. Everything else moves to
   plugin data on `figma.root`. One-time migration: when a file has no per-file
   settings yet, copy the user's old clientStorage values into it.
4. **Message contract.** `Settings` in `src/messages.ts` splits into a user part
   (token) and a file part (repo, branch, parent folder, projects). The UI must
   change in the same step (UI is owned by Jakob).
5. **Projects.** A project = `{ id, name, description, folder }`. Each doc frame
   belongs to one project. The sync target folder becomes
   `<parent folder>/<project folder>`. Each folder already gets its own sync manifest,
   so projects don't interfere with each other.

## Known issue: renaming a folder

The sync only looks inside the current target folder. If a project's folder (or the
parent folder) is renamed, the old folder and its files stay in the repo and are
never cleaned up. The new folder starts empty and gets a fresh copy.
Decision: accept it as a limitation. When someone changes a folder (file setting or
personal override), show a warning: "Docs will go to the new folder. The old folder
stays in the repo as it is. To move or rename existing docs, do it on GitHub, then
sync again."

## Out of scope

- Version history of the per-file settings
- Locking file settings so not everyone can change them (future)
- Multiple repos per file
