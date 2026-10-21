# Changelog

This is a fork of
[antoniowav/omarchy-workspace-switcher](https://github.com/antoniowav/omarchy-workspace-switcher)
(upstream 1.0.0, commits `ee12dfa` / `92a5c73`). Everything below is either new
on top of that upstream release or a fix for a defect in it.

Versions 1.3.0, 1.4.0, 1.4.1 and 1.4.2 were developed and verified on the live
install but landed in a single commit together with 1.4.3, so only the states in
the table are tagged.

| version | where | date | headline |
|---|---|---|---|
| 1.0.0 | upstream `92a5c73` | 2026-10-06 | upstream base plugin |
| 1.1.0 | tag `v1.1.0` | 2026-10-08 | fork: key arrangement, accent tint, review fixes |
| 1.2.0 | tag `v1.2.0` | 2026-10-08 | finger-following 3F swipe, live settings, file-stream input |
| 1.3.0 – 1.4.3 | tag `v1.4.3` | 2026-10-09 | all input on one stream, overview muting, alpha-correct previews |
| 1.4.4 | tag `v1.4.4` | 2026-10-09 | wiring ships with the plugin, stream moves to `$XDG_RUNTIME_DIR` |
| 1.4.5 | tag `v1.4.5` | 2026-10-09 | closing swipe made symmetric: 30 % of the travel, like opening |
| 1.4.6 | tag `v1.4.6` | 2026-10-11 | Super + Tab no longer also fires Omarchy's stock Next workspace bind |
| 1.4.7 | tag `v1.4.7` | 2026-10-21 | preview wait ends when the previews land; arrow keys stop at the row edge; robustness pass |

## Implementations (new on top of upstream)

1. **Key arrangement, and it is a choice** (1.1.0; inverted in 1.3.0; switchable
   since 1.4.4) — the overview can be driven from `Super + Tab`, or from
   `Alt + Tab` while `Super + Tab` is left to Hyprland, by setting
   `OMARCHY_SWITCHER_MOD` before the wiring include. The plugin itself binds
   nothing: it only acts on what the wiring file streams.
2. **File-stream input architecture** (1.2.0, completed in 1.3.0) — every input
   event (key presses and gesture phases) is one line appended to
   `$XDG_RUNTIME_DIR/omarchy-workspace-switcher-swipe`, which the plugin tails.
   The earlier runtime key takeover (`applyBindings`, `restoreScripts`, owner
   token, rebind timer, `configreloaded` hook, `restoreScript`) was removed
   entirely: nothing to restore on unload, nothing to break on a config reload.
3. **Finger-following three-finger swipe** (1.2.0; hardened through 1.4.3) —
   the sheet follows the fingers (backdrop opacity and card scale), commits past
   30 % of the travel, reverts on cancel, closes on up *or* down while open; a
   5 s stream watchdog never commits a stale gesture, the tail auto-respawns, and
   the stream truncates itself when idle with a 64 KB cap on the Lua writer.
4. **Live settings file** (1.2.0) — `~/.config/omarchy/workspace-switcher.json`
   is re-read on save; no shell restart, and the plugin never writes it.
5. **Numeric card order with display-independent tap-flip** (`d906c77`) —
   `numericOrder` shows cards 1, 2, 3… while a tap still selects the workspace
   you came from, mapped onto however the cards are displayed.
6. **Theme-following visuals** (1.1.0 → 1.4.3) — accent-tinted backdrop
   (`accentTint`), solid tiles for windows without preview content, an opaque
   preview bed so translucent windows read as tiles instead of ghosts, per-window
   name chips and a "Current" tag.
7. **The desktop cannot change under the overview** (1.4.0) — a Wayland
   keyboard-shortcuts inhibitor on the overview layer, with `disable_inhibit`
   exemptions for the open/close swipes, and the keys the inhibitor mutes ridden
   through the layer instead (Tab / Shift+Tab cycle, releasing the modifier
   commits).
8. **Preview capture pipeline** (1.4.2, 1.4.3) — previews are captured in
   focused-card-first order, handed out one per tick (`captureStaggerMs`) so the
   opening animation keeps its frames, optionally held back until they are all
   in (`previewWaitMs`), and rendered alpha-correctly on the dmabuf transport
   (see bugfix 9).
9. **Terminal and app labelling coverage** (1.1.0 → 1.3.0) — the terminal class
   list grew from five entries to thirteen (Konsole, GNOME Terminal, xterm,
   WezTerm, Terminator, …), with Claude Code session names, shell-prompt
   directories and per-window labels.
10. **Wiring that ships with the plugin** (1.4.4) — the Hyprland gestures, key
    binds and release commit live in
    [`hypr/workspace-switcher.lua`](hypr/workspace-switcher.lua), pulled into the
    user's config with one include, guarded against double loading, with knobs
    for the key arrangement and the horizontal workspace swipe.
11. **Documentation and tests** — rewritten README (install, toggles, settings,
    known gaps) and a Node test suite covering ordering, selection, layout,
    arrow-key movement, capture order/targets and settings parsing.

## Bugfixes

Defects in the upstream plugin or its dependencies. Fixes for problems the fork
itself introduced during development are deliberately not part of this list; they
are recorded in the commit messages.

1. **Crash / NaN layout on clients without numeric geometry** (1.1.0) —
   `buildWorkspaces` used `c.at[0]` and `c.size[0]` unguarded; such clients are
   now skipped instead of poisoning every card's geometry.
2. **State-machine wedge on a failed query** (1.1.0, hardened in 1.4.2) —
   upstream returned from `finishQuery` on a JSON parse failure and on an empty
   workspace list without closing, and had no timeout at all, so a hung `hyprctl`
   left the switcher unable to open. Now it closes cleanly and a 2 s watchdog
   clears the query.
3. **"Silent teleport" to another workspace** (1.1.0) — stale `commitPending` /
   `pendingSteps` from a cancelled open turned a later toggle into an immediate
   workspace switch; `toggle()` now clears them.
4. **Junk `desktop` app-name key** (1.1.0) — upstream indexed desktop-entry ids
   with their `.desktop` suffix, which leaked into class lookups.
5. **Wrong app names** (1.1.0) — reverse-DNS ids (`org.gimp.GIMP`) were not
   matched by bare class names, and `soffice.bin` was not recognised as
   LibreOffice.
6. **Wrong terminal labels** (1.1.0) — shell-prompt sigils (`$`, `#`, `%`) and
   terminal-appended titles ("… — Konsole") were shown as window content.
7. **Unload clobbered the user's own key bindings** (1.3.0) — upstream's
   `restoreScript` rewrote the machine's binds with Omarchy stock on unload; the
   whole runtime-takeover design it belonged to is gone.
8. **Unreliable key delivery** (1.3.0) — upstream's mechanism depended on
   quickshell 0.2.1 `GlobalShortcut`s, which silently drop per-instance subsets;
   input now rides the file stream, and the global shortcuts remain only as
   unbound secondary triggers.
9. **Translucent previews showed the desktop through the panel** (1.4.1
   diagnosis, 1.4.3 fix) — quickshell 0.2.1 wraps dmabuf capture textures
   without their alpha flag (`QSGOpenGLTexture::fromNative` takes no
   `TextureHasAlphaChannel`), so captures were drawn unblended and transparent
   pixels punched holes through the whole panel surface (measured: 52–93 % of the
   affected pixels identical to the bare desktop). The plugin now draws each
   preview through a QML layer / at `opacity: 0.995`, measured pixel-identical
   to the correct shm path, which keeps the cheap dmabuf transport. The
   `QS_DISABLE_DMABUF=1` workaround this replaced is no longer needed and should
   not be set.
10. **`Super + Tab` fired twice** (1.4.6) — the wiring bound the key without
    unbinding Omarchy's stock "Next workspace" bind first, and Hyprland fires
    every bind registered for a chord instead of shadowing the older one, so each
    press jumped a workspace and opened the overview. The wiring now unbinds the
    chord it takes over before binding it (in the ALT arrangement, Omarchy's
    `Alt + Tab`, which is the key that arrangement exists to free). Same defect,
    found independently, as upstream's 1.4.5.
11. **The preview wait never ended early** (1.4.7) — the counter of landed
     previews lived on the *card* delegate while the counter of windows that can
     land one lives per window, so the two counted different things: the wait
     compared a number of cards with a number of windows and could never be
     satisfied as soon as one workspace held more than one window. With
     `previewWaitMs` set, the sheet then always waited the full timeout instead
     of appearing as soon as its previews were there. Measured on three
     windows in one workspace: the counter stopped at 1 of 3 and the sheet
     revealed on the timeout; it now reaches 3 of 3 and reveals with the
     previews.
12. **The arrow keys walked into the neighbouring row** (1.4.7) — left and right
     were bounded by the grid, not by the row, so the last card of a row walked
     into the first card of the next one and the first card of a row walked
     back into the last card of the previous one. They now stop at the edge of
     the row, like up and down stop at the edge of the grid.
13. **An unknown gesture direction was read as "up"** (1.4.7) — the input
     parser treated every direction that was not "down" as "up", so a line from
     something else could open the overview. It now accepts "up" and "down"
     only.
14. **The wiring and the plugin could disagree on the stream path** (1.4.7) —
     the plugin falls back to `/tmp` when `XDG_RUNTIME_DIR` is empty, the
     wiring did not (`""` is truthy in Lua), so with an empty runtime dir the
     writer would have written to `/omarchy-workspace-switcher-swipe` while the
     reader tailed `/tmp/omarchy-workspace-switcher-swipe`: the stream would
     silently never have worked. Both sides now fall back the same way.
15. **Two unguarded reads** (1.4.7) — the app-name index threw on a null
     desktop entry and the workspace builder on a null state. Neither was
     reachable from the plugin, but both are one bad value away from taking
     the overview down.

## Robustness and clean-up (1.4.7)

- The preview counter is per window (see bugfix 11).
- The arrow keys stop at the edge of the row (see bugfix 12).
- The input parser rejects unknown directions (see bugfix 13).
- The wiring and the plugin agree on the runtime-dir fallback (see bugfix 14).
- The app-name index and the workspace builder survive null input.
- The five global shortcuts register under one `appId` property instead of
  repeating the string, and the plugin no longer imports `qs.Ui`, which it
  never used.
- The README now names the shell utilities the plugin uses (`tail`,
  `truncate`, `touch`, `sh`) instead of claiming `hyprctl` is the only one.
- Three test suites now cover the plugin: `node test/logic-test.js` (the
  behaviour), `node test/audit-test.js` (edge cases, a fuzz pass and the QML's
  invariants) and `luajit test/lua-test.lua` (the Hyprland wiring, against a
  stubbed `hl` API — it had no test at all before).
