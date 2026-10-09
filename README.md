# Workspace Switcher

Super + Tab for Omarchy workspaces.

Fork of [antoniowav/omarchy-workspace-switcher](https://github.com/antoniowav/omarchy-workspace-switcher),
rebound to Super + Tab so Alt + Tab stays free for window cycling.

- **Tap Super + Tab** to flip to the workspace you were on before. Tap it again to flip back.
- **Hold Super and press Tab** to see every workspace — number order by default,
  order of visit with a setting off — with live previews of its windows. Each
  Tab steps one card along in the order the cards are displayed (Shift + Tab
  steps back), and letting
  go of Super switches to it. Previews are visible as the sheet opens (each is
  one frame, captured as it appears, and they land within ~0.1-0.2 s; with
  `previewWaitMs` set the sheet waits for them instead and appears already
  populated).
- **Swipe up with three fingers** to open the overview following your fingers
  (the same engine the horizontal workspace swipe uses); release past 30% of
  the travel to open, below to snap back. While it is open, a three-finger
  swipe up **or** down closes it the same way; swiping down while it is
  closed does nothing.
- Click a window to focus it, or click empty space in a card to go to that workspace.
  The arrow keys and Return work too, and Escape closes it.
- While the overview is showing it holds a keyboard-shortcuts inhibitor, so
  nothing can change the desktop under it: Super+digit workspace jumps,
  Super+Ctrl+arrows and the three-finger horizontal workspace swipe are all
  muted for as long as it is open (the open/close swipes are exempt — they
  register `disable_inhibit`). Tab, Shift + Tab and letting go of Super keep
  working: the overview handles them itself.
- Each window is labelled with its app's name. Terminals show what they are doing
  instead: a Claude Code session's name (as the top bar shows it), the folder of a
  shell prompt, or the running program's title. Transparent terminals composite
  over a solid bed, so they read as tiles, not ghosts.

![Workspace Switcher](preview.png)

## Install

```bash
omarchy plugin add https://github.com/IsseyShiitake/omarchy-workspace-switcher --enable
```

Then add the key and gesture lines below to your Hyprland config and reload:
that is what wires Super + Tab and the three-finger swipe. The plugin itself
needs no restart.

## Keys and touchpad gestures

All input rides one stream: `/tmp/omarchy-workspace-switcher-swipe`, one line
per event, written by gesture callbacks and Lua-function key binds, which the
plugin tails live. No runtime key takeover, nothing to restore on unload, and
nothing that breaks on a config reload. The gestures use the same
begin/update/end callback engine the horizontal workspace swipe rides
(Hyprland 0.56's `gesture` keyword), so the overview follows your fingers and
commits on release; a global dispatch carries no payload, which is why the
events are streamed through the file instead. Add this to
`~/.config/hypr/input.lua` (or to `hyprland.lua` on a flat config):

```lua
local ws_swipe_dy = 0
local ws_swipe_last = ""
local ws_stream_bytes = 0
-- Append, never truncate in place (except at the size cap): the plugin tails
-- this file, and a truncate+rewrite of similar length is invisible to
-- `tail -f` — a shrink to zero IS seen and resets it. The plugin empties the
-- file itself once a gesture has been over for a moment; the cap only bounds
-- growth when no plugin is tailing.
local function ws_swipe_write(line, dedupe)
    if dedupe == nil then dedupe = true end
    if dedupe and line == ws_swipe_last then return end
    ws_swipe_last = line
    local mode = "a"
    if ws_stream_bytes > 65536 then mode = "w"; ws_stream_bytes = 0 end
    local f = io.open("/tmp/omarchy-workspace-switcher-swipe", mode)
    if f then
        if f:write(line, "\n") then ws_stream_bytes = ws_stream_bytes + #line + 1 end
        f:close()
    end
end
-- Key presses must each land (hold-Tab cycling repeats the bind), so they
-- bypass the update-dedupe: consecutive identical key lines are distinct
-- presses.
local function ws_key_write(name)
    ws_swipe_write("key " .. name, false)
end
local function ws_swipe_action(dir)
    -- NOTE: the release callback's table key is "finish". Hyprland 0.56
    -- reads start/update/finish; an "end" key is silently ignored, which
    -- leaves the overview following the fingers with no release event.
    return {
        start = function(e)
            ws_swipe_dy = 0
            ws_swipe_last = ""
            ws_swipe_write("begin " .. dir)
        end,
        update = function(e)
            ws_swipe_dy = ws_swipe_dy + e.delta.y
            ws_swipe_write(string.format("update %s %.2f", dir, ws_swipe_dy))
        end,
        finish = function(e)
            ws_swipe_write("end " .. dir .. ((e and e.cancelled) and " cancelled" or ""))
        end,
    }
end
-- disable_inhibit: the overview holds a keyboard-shortcuts inhibitor while
-- open (it mutes every keybind and gesture for its surface, so the desktop
-- can't change underneath); these two swipes stay exempt so it can close.
hl.gesture({ fingers = 3, direction = "up",   action = ws_swipe_action("up"),   disable_inhibit = true })
hl.gesture({ fingers = 3, direction = "down", action = ws_swipe_action("down"), disable_inhibit = true })
-- Super + Tab cycles workspaces (Alt + Tab stays free for window cycling);
-- letting go of Super commits the choice. Transparent: or Super+Tab's own
-- bind shadows the release; non_consuming: apps still see Super; ignore_mods:
-- fires with Shift held.
hl.bind("SUPER + Tab", function() ws_key_write("next") end,
    { description = "Switch workspace (hold Super)" })
hl.bind("SUPER + SHIFT + Tab", function() ws_key_write("previous") end,
    { description = "Switch workspace backwards (hold Super)" })
for _, key in ipairs({ "Super_L", "Super_R" }) do
    hl.bind("SUPER + " .. key, function() ws_key_write("commit") end,
        { release = true, transparent = true, non_consuming = true, ignore_mods = true })
end
ws_swipe_write("init")
```

The plugin doesn't add these for you: Hyprland can't remove a gesture once it
is added, and you may already use these swipes or Super + Tab for something
else. With the plugin's `gestureOpen` setting off (or the plugin disabled) the
gesture lines are written and ignored; the key lines are ignored too, and
Super + Tab does whatever your own config binds there.

Five `GlobalShortcut`s (`toggle`, `next`, `previous`, `commit`, `close`) are
also registered as secondary triggers for anything that wants them — beware
that on quickshell 0.2.1 their delivery is unreliable (per-instance subsets
silently never fire), which is why the stream above is the primary path.

## How it changes your key bindings

It doesn't, at runtime: the keys it uses are the Lua binds you added above,
in your own config. Nothing is taken over, and disabling the plugin (or
removing it) needs no cleanup — the stream lines are simply ignored.

| Keys | With the binds + plugin |
|---|---|
| Super + Tab | Flip to the previous workspace, or hold Super to cycle |
| Super + Shift + Tab | Cycle backwards |
| Letting go of Super | Switch to the selected workspace (only after Super + Tab) |

Letting go of Super is passed on to apps as usual. Alt + Tab is never used:
whatever you have bound there (window cycling, Omarchy's next workspace, …)
works exactly as before, with the plugin enabled or disabled.

Other plugins that bind Super + Tab in their config conflict with the lines
above: keep only one.

## Configuration

Five settings in `~/.config/omarchy/workspace-switcher.json` (create the file
as needed; a missing file, missing keys or malformed JSON all mean "on").
Editing the file applies live, without a shell restart:

```json
{
  "gestureOpen": true,
  "accentTint": true,
  "numericOrder": true,
  "captureStaggerMs": 8,
  "previewWaitMs": 0
}
```

- `gestureOpen` (default `true`) — the three-finger swipe stream is followed
  (see Touchpad gestures above). `false` reverts to the base plugin: the
  swipes do nothing and the overview opens only from Super + Tab or the
  `toggle` global.
- `accentTint` (default `true`) washes the backdrop with a whisper of the
  theme's popup-border color (the edge on bluetooth/sound flyouts), light or
  dark as the active theme is. `false` reverts to the plain theme background.
- `numericOrder` (default `true`) displays the cards in number order
  (1, 2, 3, …) instead of order of visit. A tap still flips to the workspace
  you were on before — the highlight just starts there; further Tabs walk the
  cards as displayed. `false` reverts to visit-ordered cards, current first.
- `previewWaitMs` (default `0`, clamped to 0–1000; this install runs `200`) — how long the sheet may
  wait for its previews before revealing itself. `0` reveals at once and the
  previews fill in as they land: the sheet is up ~40 ms after the key press,
  the first preview is there ~0.1 s later and the last within ~0.2 s, so the
  cards show their window name for a moment. `200` (say) holds the sheet back
  until every preview has content or the wait runs out — the sheet then
  appears already populated and its animation is perfectly smooth, at the cost
  of appearing ~0.17 s later. Measured on 7 windows: `0` → reveal at ~40 ms,
  previews 90–225 ms; `200` → reveal at ~170–200 ms with 7/7 previews ready
  and animation samples one frame apart.
- `captureStaggerMs` (default `8`, clamped to 0–500) — the gap between two
  window previews being captured, so the whole batch does not land on one
  frame of the opening animation. `0` captures everything at once: the
  previews are as early as they can be, at the cost of the animation's first
  ~0.1 s. Larger values are gentler on slow machines and slower to fill.

Workspaces you haven't visited since the shell started are listed last, in
number order. The order starts fresh when the shell restarts.

## Requirements

Omarchy 4 (Quattro) with its Quickshell shell and Hyprland 0.56 or later. No other
dependencies. The plugin runs `hyprctl` to read your workspaces and windows, to switch
workspaces, and to set the key bindings above. It needs no network access and no
privileges.

**Known quickshell 0.2.1 issue (worked around here):** on the dmabuf screencopy
path the texture wrapper is format-blind (`QSGOpenGLTexture::fromNative` without
`TextureHasAlphaChannel`), so `ScreencopyView` renders unblended — transparent
pixels of the captured window punch a hole through the whole panel surface and
the live desktop shows through the card. Measured on a 45 %-opacity blurred
Konsole: 52–93 % of the affected preview's pixels were pixel-identical to the
bare desktop. The plugin draws each preview at `opacity: 0.995`, which makes the
scene graph blend the capture instead (half a percent of the bed mixes in where
the window is transparent); that was pixel-verified identical to the shm capture
path, needs no offscreen buffer, and is ~45 ms faster to appear than the other
workaround (routing the capture through a QML layer, which also works). dmabuf
matters because the shm fallback makes the *compositor* copy every capture
synchronously into shared memory inside one output-commit callback
(full-resolution `glReadPixels` — see Hyprland's `CScreenshareFrame::copyShm`),
which stalls the whole desktop and used to make the opening animation render in
two or three jumps. Do **not** set `QS_DISABLE_DMABUF=1` for this plugin any
more; if you do (another consumer needs it, say), raise `captureStaggerMs` to
~40 and expect the previews to fill in progressively instead.

The real fix belongs upstream in quickshell: pass
`QQuickWindow::TextureHasAlphaChannel` when the imported dmabuf format has an
alpha channel (the same thing its Vulkan path already does for XRGB formats).

## Remove

```bash
omarchy plugin remove io.github.antoniowav.workspace-switcher
```

If you added the key and gesture lines, remove them from `~/.config/hypr/input.lua` too.

## Development

The logic is in `WorkspaceSwitcherLogic.js` and is tested with `node test/logic-test.js`.

## License

MIT. See [LICENSE](LICENSE).
