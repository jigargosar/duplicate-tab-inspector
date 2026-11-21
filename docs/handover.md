# Handover

## Goal

A Chrome extension that finds duplicate tabs and closes them.
That is the primary feature, and the work so far serves only that.

## Background

- `docs/mockups/` holds earlier builds, from v1 (`duplicate-tab-inspector/`) to v7.3.0.
- Each version was a near-full rewrite, and later versions regressed.
- Their READMEs describe what was added, but those are not requirements.
- We restarted from v1, because v1 already did the primary feature.

## Working agreement with the user

- Small edits to existing code, never rewrites.
- WIP commits after every step, pushed to `origin/main`.
- Test each change in the test Chrome before moving on.
- Recommend one next step and ask before taking it.
- When unsure or guessing, stop and ask.
- Never touch the user's own Chrome.
- Keep `docs/spec.md` short, and mark anything taken from old code as observed, not required.

## Current state

- WXT project in the repo root, TypeScript, pnpm.
- `entrypoints/popup/` is v1 ported to TypeScript.
- It differs from v1 in two ways.
- A missing element or a tab without an id throws instead of failing silently.
- The match key uses `host` instead of `hostname`, so different ports are different pages.
- `tools/test-close.ts` passes all 6 checks.

## How to run

1. `pnpm dev` starts the WXT dev server on port 3000 and builds into `.output/chrome-mv3-dev`.
2. `node tools/launch-browser.ts` opens a separate Chrome for Testing 149 with the extension loaded and debugging on port 9222.
3. `node tools/test-close.ts` closes all tabs in the test Chrome, opens duplicates, clicks the close buttons and reports PASS or FAIL.
4. `node tools/setup-demo.ts` replaces the test Chrome's tabs with a demo set across two windows, for trying it by hand.
5. `node tools/popup-text.ts` prints the popup's text.

Keep steps 1 and 2 running in the background with a time limit.
The popup auto-reloads on save.
Changes to `wxt.config.ts` need a dev server restart and a test Chrome relaunch.

## Gotchas

- Stopping the dev server's shell can leave the `wxt` node process alive on port 3000.
- The next dev server then takes port 3001, and the test Chrome blocks its scripts with a CSP error.
- Check with `netstat -ano | grep :3000` and kill the leftover process by its id.
- The test profile in `.wxt/test-profile` restores old tabs on relaunch.
- The cached Chrome 150 folder is empty, so the launch script uses 149.
- WXT prints "Load .output/chrome-mv3-dev manually" because it does not open a browser here.
- Node's `URL` returns `null` as the origin of `chrome-extension://` URLs, so use `host`.
- The toolbar title stays "Duplicate Tab Inspector" despite `default_title` in `wxt.config.ts`, which is not investigated.

## Observed v1 behavior, from the demo run

- Hash is ignored by default, so `#History` was closed with the other copies.
- `example.com` and `www.example.com` are different pages.
- Query parameters are sorted, so `?a=1&b=2` and `?b=2&a=1` match.
- The kept copy is the active tab if the group has one, otherwise the first.
- Every window has an active tab, so a group can hold several, and the kept one is arbitrary.
- Pinned tabs are not protected.

## Suspected, not verified

- Clicking a row to switch to a tab in another window probably closes the popup.
- Closing a tab that is already gone throws, and nothing reports it.

## Next

- Ask the user what they noticed when trying the demo.
- Pick the next fix from that, test first.
