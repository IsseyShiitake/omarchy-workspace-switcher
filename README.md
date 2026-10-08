# Workspace Switcher

Alt + Tab for Omarchy workspaces.

Fork of [antoniowav/omarchy-workspace-switcher](https://github.com/antoniowav/omarchy-workspace-switcher),
rebound to Alt + Tab so Super + Tab stays free for window cycling.

- **Tap Alt + Tab** to flip to the workspace you were on before. Tap it again to flip back.
- **Hold Alt and press Tab** to see every workspace — number order by default,
  order of visit with a setting off — with live previews of its windows. Each
  Tab moves to the next most recent one (Shift + Tab goes back), and letting
  go of Alt switches to it.
- **Swipe up with three fingers** to open the overview following your fingers
  (the same engine the horizontal workspace swipe uses); release past 40% of
  the travel to open, below to snap back. While it is open, a three-finger
  swipe up **or** down closes it the same way.
- Click a window to focus it, or click empty space in a card to go to that workspace.
  The arrow keys and Return work too, and Escape closes it.
- Each window is labelled with its app's name. Terminals show what they are doing
  instead: a Claude Code session's name (as the top bar shows it), the folder of a
  shell prompt, or the running program's title. Transparent terminals composite
  over a solid bed, so they read as tiles, not ghosts.

![Workspace Switcher](preview.png)

## Install

```bash
omarchy plugin add https://github.com/IsseyShiitake/omarchy-workspace-switcher --enable
```

Alt + Tab works as soon as the plugin is enabled.

## Touchpad gestures (optional)

The three-finger swipe uses the same begin/update/end callback engine the
horizontal workspace swipe rides (Hyprland 0.56's `gesture` keyword), so the
overview follows your fingers and commits on release. A global dispatch
carries no payload, so the gesture callbacks stream each event (phase and the
accumulated finger dy) to the plugin through a one-line file it watches:
`/tmp/omarchy-workspace-switcher-swipe`. Add this to `~/.config/hypr/input.lua`
(or to `hyprland.lua` on a flat config):

```lua
local ws_swipe_dy = 0
local ws_swipe_last = ""
-- Append, never truncate in place: the plugin tails this file, and a
-- truncate+rewrite of similar length is invisible to `tail -f`. The plugin
-- empties the file itself once a gesture has been over for a moment.
local function ws_swipe_write(line)
    if line == ws_swipe_last then return end
    ws_swipe_last = line
    local f = io.open("/tmp/omarchy-workspace-switcher-swipe", "a")
    if f then f:write(line, "\n") f:close() end
end
local function ws_swipe_action(dir)
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
        ["end"] = function(e)
            ws_swipe_write("end " .. dir)
        end,
    }
end
hl.gesture({ fingers = 3, direction = "up",   action = ws_swipe_action("up") })
hl.gesture({ fingers = 3, direction = "down", action = ws_swipe_action("down") })
```

The plugin doesn't add them for you: Hyprland can't remove a gesture once it is added,
and you may already use these swipes for something else. With the plugin's
`gestureOpen` setting off (or the plugin disabled) the file is written and
ignored, and the swipes do nothing.

## How it changes your key bindings

While the plugin is enabled it takes over three bindings at runtime, with `hyprctl
eval`. It never edits your config files.

| Keys | With the plugin |
|---|---|
| Alt + Tab | Flip to the previous workspace, or hold Alt to cycle |
| Alt + Shift + Tab | Cycle backwards |
| Letting go of Alt | Switch to the selected workspace (only after Alt + Tab) |

Letting go of Alt is passed on to apps as usual. Super + Tab is never touched:
whatever you have bound there (window cycling, Omarchy's next workspace, …)
works exactly as before, with the plugin enabled or disabled.

Other plugins that take Alt + Tab conflict with this one: enable only one of them.

## Configuration

Three settings in `~/.config/omarchy/workspace-switcher.json` (create the file
as needed; a missing file, missing keys or malformed JSON all mean "on").
Editing the file applies live, without a shell restart:

```json
{
  "gestureOpen": true,
  "accentTint": true,
  "numericOrder": true
}
```

- `gestureOpen` (default `true`) — the three-finger swipe stream is followed
  (see Touchpad gestures above). `false` reverts to the base plugin: the
  swipes do nothing and the overview opens only from Alt + Tab or the
  `toggle` global.
- `accentTint` (default `true`) washes the backdrop with a whisper of the
  theme's popup-border color (the edge on bluetooth/sound flyouts), light or
  dark as the active theme is. `false` reverts to the plain theme background.
- `numericOrder` (default `true`) displays the cards in number order
  (1, 2, 3, …) instead of order of visit. A tap still flips to the workspace
  you were on before — the highlight just starts there; further Tabs walk the
  cards as displayed. `false` reverts to visit-ordered cards, current first.

Workspaces you haven't visited since the shell started are listed last, in
number order. The order starts fresh when the shell restarts.

## Requirements

Omarchy 4 (Quattro) with its Quickshell shell and Hyprland 0.56 or later. No other
dependencies. The plugin runs `hyprctl` to read your workspaces and windows, to switch
workspaces, and to set the key bindings above. It needs no network access and no
privileges.

## Remove

```bash
omarchy plugin remove io.github.antoniowav.workspace-switcher
```

If you added the gesture lines, remove them from `~/.config/hypr/input.lua` too.

## Development

The logic is in `WorkspaceSwitcherLogic.js` and is tested with `node test/logic-test.js`.

## License

MIT. See [LICENSE](LICENSE).
