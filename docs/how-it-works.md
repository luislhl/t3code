# How this fork works

## Branches

| Branch         | Contents                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| `fork/ci`      | Default branch. This documentation and the sync workflow. No T3 Code source.          |
| `fork/patches` | Upstream's latest stable tag plus this fork's patches, one commit per patch.          |
| `main`, others | Left over from creating the fork. Nothing reads or updates them.                      |

`fork/ci` is the default branch on purpose. GitHub only runs scheduled
workflows from the default branch, and this one contains no upstream
workflows. Upstream's release workflow would otherwise run here on a
schedule and try to publish to npm, the AUR and the web.

Upstream's other workflows only react to pushes to `main`, pull requests and
`v*` tags. The sync never pushes to those refs. It creates release tags
through the GitHub API with the Actions token, and events from that token
don't start other workflows.

## The sync workflow

[`.github/workflows/fork-sync.yml`](../.github/workflows/fork-sync.yml) runs
every hour and on demand. It has two jobs.

**Sync** finds upstream's latest stable release, for example `v0.0.43`.
If this fork has already released that tag, the run ends in a few seconds.
Otherwise it:

1. Finds the stable tag `fork/patches` currently sits on, for example
   `v0.0.42`, and moves the patches onto the new tag with
   `git rebase --onto v0.0.43 v0.0.42`.
2. Checks every workspace package the patches touch. It runs that package's
   typecheck, then the test files the patches add or change. The typecheck
   catches upstream API changes that rebase without a text conflict.
3. Pushes the rebased `fork/patches`. A lease stops it from overwriting a fix
   you pushed while the job ran.

If the rebase or a check fails, nothing is pushed or published, and the run
fails.

**Release** checks out the pushed `fork/patches` and builds the Linux x64
AppImage the same way upstream's release workflow does. It then publishes a
release with the upstream version number. The build bakes this repository
into the app's update feed. Before publishing, it checks that the AppImage
really points at this fork.

Patches are rebased once per upstream release, not continuously onto
upstream `main`. A stable tag is older than `main`, so `main`-based patches
often fail to apply to it. Moving from tag to tag only conflicts when upstream
changed the same lines during that release cycle, which is exactly when a
human needs to look.

## Updates

The desktop app uses `electron-updater` with GitHub Releases. The repository
it reads is fixed at build time from `T3CODE_DESKTOP_UPDATE_REPOSITORY`, which
the release job sets to this fork. After the first manual install, the app
offers each new fork release like any normal update.

Versions match upstream exactly. The updater only offers a higher version, so
a patch change between upstream releases does not reach an installed app on
its own. See [Changing the patches](#changing-the-patches).

## The warning in the app

Fork builds check this workflow's latest completed run through the public
GitHub API every 30 minutes. That's well inside the 60 requests per hour
GitHub allows without a token.

- **Fork sync failed**: the latest run failed. **Open** goes to that run.
- **Fork sync stopped**: no run has finished in 12 hours. **Open** goes to the
  workflow. GitHub turns off schedules in repositories with no activity for
  60 days, and it sometimes delays or skips scheduled runs.

The warning stays up until a later run succeeds. If you dismiss it while the
problem remains, it comes back on the next check. GitHub also emails you when
a scheduled run fails.

The check is compiled in only when `VITE_T3CODE_FORK_REPOSITORY` is set at
build time, which only the release job does.

## One-time setup

These commands assume a local clone whose `origin` is upstream
(`pingdotgg/t3code`) and which has the `fork/ci` and `fork/patches` branches.

1. Create the fork and push both branches:

   ```bash
   gh repo fork pingdotgg/t3code --clone=false --default-branch-only
   git remote add fork git@github.com:luislhl/t3code.git
   git push fork fork/ci fork/patches
   gh repo edit luislhl/t3code --default-branch fork/ci
   ```

2. In the fork's **Actions** tab, enable workflows. GitHub disables them in
   new forks.

3. Create a
   [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   that can only access `luislhl/t3code`, with **Contents: Read and write** and
   **Workflows: Read and write**. The Actions token can't push `fork/patches`,
   because rebased upstream commits change files under `.github/workflows`.
   Save the token as a secret:

   ```bash
   gh secret set FORK_SYNC_TOKEN -R luislhl/t3code
   ```

4. Run the workflow once instead of waiting for the schedule. With no
   release yet, it builds the current upstream release:

   ```bash
   gh workflow run fork-sync.yml -R luislhl/t3code --ref fork/ci
   gh run watch -R luislhl/t3code
   ```

5. Download the AppImage from the new release. Quit T3 Code, keep the official
   AppImage as a backup, and start the fork's AppImage in its place. It uses
   the same app ID and the same `~/.t3` data.

## When the sync fails

The failed run names the step and the conflicting files. Fix it locally, with
`fork` as the fork's remote:

```bash
git fetch origin --tags
git fetch fork
git switch fork/patches
git reset --hard fork/fork/patches

# Replace with the tag the patches are on and the new upstream tag.
git rebase --onto v0.0.43 v0.0.42
# Resolve conflicts, then: git add <files> && git rebase --continue

vp install
# Run the typecheck and changed tests of each patched package, the same
# checks as the workflow. For example:
(cd apps/server && vp run typecheck && vp test run src/orchestration/IdleCompactionReactor.test.ts)

git push --force-with-lease fork fork/patches
gh workflow run fork-sync.yml -R luislhl/t3code --ref fork/ci
```

If the rebase applied cleanly but a check failed, upstream changed an API the
patches use. Fix it in the patch commit, for example with
`git commit --fixup` and `git rebase --autosquash`.

## Changing the patches

- **Add or edit a patch:** commit on `fork/patches`, keeping one commit per
  concern, and push with `--force-with-lease` when you rewrite history.
- **Ship it now:** the next upstream release picks it up automatically. To get
  it sooner, delete this fork's release for the current tag, then run the
  workflow with `release_tag` set to that tag. Download the AppImage by hand,
  because the version number didn't change.
- **When upstream merges a patch:** if upstream's version is identical, the
  rebase drops the now-empty commit on its own. If it differs, the rebase
  conflicts. Drop the commit with `git rebase --onto` or by rewriting
  `fork/patches`.

The idle compaction patch here differs slightly from the version proposed
upstream. It wires the reactor through `OrchestrationReactorLive` instead of
`apps/server/src/server.ts`, because upstream edits that file constantly.
Likewise, the warning starts from one line appended to `apps/web/src/main.tsx`
instead of an edit inside the sidebar.

These patches edit files upstream changes often, so they are the most likely
places for a rebase conflict:

- Keeping a snoozed thread snoozed through idle compaction edits
  `apps/server/src/orchestration/decider.ts`.
- Pinned messages add three short insertions to
  `apps/web/src/components/chat/MessagesTimeline.tsx`: the pin button beside
  the user and assistant copy buttons, and `<PinnedMessages>` beside
  `<TimelineMinimap>`. Everything else lives in new files, so a conflict here
  means putting those lines back.
- Thread notes add an import and one `<ThreadNotesButton>` line to
  `apps/web/src/components/chat/ChatHeader.tsx`, just before the header's
  actions menu. The notepad itself lives in new files.

## Limits

- Linux x64 only. The other targets need signing certificates or other runners.
- No T3 Connect. Its relay URL and sign-in keys come from upstream's private
  CI configuration.
- Stable channel only.
- Builds run on free GitHub-hosted runners, so a release takes roughly 30 to
  60 minutes after upstream publishes.
