# T3 Code, personal fork

This is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). It
follows upstream's stable releases and adds a few patches on top. It is not
affiliated with or supported by the T3 Code maintainers.

## What it adds

- **Idle compaction minimum for Claude.** Upstream's **Before the cache
  expires (beta)** idle compaction only compacts threads over 200,000 tokens.
  **Idle compaction minimum** in a Claude provider's settings changes that
  threshold, from 1,000 to 1,000,000 tokens.
- **Pinned messages.** Hover a message and select its pin button to pin it. A
  pin count in the top left of the thread lists the pins and jumps to one.
  Pins are saved in the app on this device only.
- **Thread notes.** The notepad button in a thread's top bar keeps a
  plain-text note for that thread, with a Markdown preview and a resizable
  box. The button is highlighted while the thread has a note, and settling a
  thread with a note asks you to confirm first. Notes are saved in the app on
  this device only.
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
