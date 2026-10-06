# Workspace Switcher

Alt + Tab for Omarchy workspaces.

- **Tap Super + Tab** to flip to the workspace you were on before. Tap it again to flip back.
- **Hold Super and press Tab** to see every workspace in order of visit, current first,
  with live previews of its windows. Each Tab moves to the next most recent one
  (Shift + Tab goes back), and letting go of Super switches to it.
- Click a window to focus it, or click empty space in a card to go to that workspace.
  The arrow keys and Return work too, and Escape closes it.
- Each window is labelled with its app's name. Terminals show what they are doing
  instead: a Claude Code session's name (as the top bar shows it), the folder of a
  shell prompt, or the running program's title.

## Install

```bash
omarchy plugin add https://github.com/antoniowav/omarchy-workspace-switcher --enable
```

Super + Tab works as soon as the plugin is enabled.

## Touchpad gestures (optional)

To open the switcher with a three-finger swipe up and close it with a swipe down, add
these lines to `~/.config/hypr/input.lua`:

```lua
hl.gesture({ fingers = 3, direction = "up", action = function() hl.dispatch(hl.dsp.global("io.github.antoniowav.workspace-switcher:toggle")) end })
hl.gesture({ fingers = 3, direction = "down", action = function() hl.dispatch(hl.dsp.global("io.github.antoniowav.workspace-switcher:close")) end })
```

The plugin doesn't add them for you: Hyprland can't remove a gesture once it is added,
and you may already use these swipes for something else.

## How it changes your key bindings

While the plugin is enabled it takes over three bindings at runtime, with `hyprctl
eval`. It never edits your config files.

| Keys | Omarchy's default | With the plugin |
|---|---|---|
| Super + Tab | Next workspace | Flip to the previous workspace, or hold Super to cycle |
| Super + Shift + Tab | Previous workspace | Cycle backwards |
| Letting go of Super | Nothing | Switch to the selected workspace (only after Super + Tab) |

Letting go of Super is passed on to apps as usual. Super + Ctrl + Tab (former
workspace) and Super + Alt + Tab (window groups) are unchanged.

When you disable or remove the plugin, Super + Tab and Super + Shift + Tab go back to
Omarchy's next and previous workspace.

If you have bound Super + Tab yourself in `~/.config/hypr/bindings.lua`, the plugin's
binding replaces yours while it is enabled. Other plugins that take Super + Tab (window
switchers, for example) conflict with this one: enable only one of them.

## Configuration

None. Workspaces you haven't visited since the shell started are listed last, in
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
