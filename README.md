# T3 Code, personal fork

This is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). It
follows upstream's stable releases and adds a few patches on top. It is not
affiliated with or supported by the T3 Code maintainers.

## What it adds

- **Idle compaction for Claude.** Claude provider settings get **Compact when
  idle for** and **Idle compaction minimum**. A thread left idle is compacted
  while Claude's prompt cache is still warm. The next message then does not
  re-send the whole conversation uncached.
  - If the computer sleeps past the compaction time, the thread is left alone,
    because its cache has likely expired by then.
  - Settled and archived threads are not compacted.
  - A snoozed thread is compacted and stays snoozed.
- **Idle session stop time for Claude.** **Stop idle sessions after** changes
  how long an idle Claude process stays alive before T3 Code stops it. Upstream
  always uses 30 minutes. A longer time lets idle compaction use more of a
  subscription's 1-hour cache, at the cost of a few hundred MB of memory per
  idle process.
- **Fork sync warning.** The app shows a warning when this fork falls behind
  upstream because the patches need a manual rebase.

The patches live on the [`fork/patches`](../../tree/fork/patches) branch as
ordinary commits on top of the latest upstream stable tag.

## What you get

A Linux x64 AppImage for every upstream stable release, with the same version
number, on this fork's [Releases](../../releases) page. Installed from there,
the app updates itself from this fork instead of upstream.

Not included: macOS and Windows builds, nightly builds, and T3 Connect.
Local network and Tailscale access work as usual.

## How it works

An hourly GitHub Actions workflow moves the patches onto each new upstream
release, checks them, and publishes the AppImage. See
[docs/how-it-works.md](docs/how-it-works.md) for the details, the one-time
setup, and what to do when a sync fails.
