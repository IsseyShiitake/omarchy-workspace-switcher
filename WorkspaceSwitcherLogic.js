// The workspace switcher's logic, kept out of the QML so it can be tested
// with node (test/logic-test.js).

// Terminals are labelled by what they are doing, from the window title.
var TERMINAL_CLASSES = ["foot", "footclient", "alacritty", "kitty", "com.mitchellh.ghostty",
  "konsole", "org.kde.konsole", "gnome-terminal-server", "org.gnome.terminal",
  "xterm", "wezterm", "org.wezfurlong.wezterm", "terminator"]

function normalizeAddress(value) {
  var address = String(value || "").toLowerCase()
  if (!address) return ""
  if (address.indexOf("0x") !== 0) address = "0x" + address
  return /^0x[0-9a-f]+$/.test(address) ? address : ""
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Window"
}

// Desktop-entry names keyed by window class, desktop id, and (for Chromium
// web apps, whose class is "chrome-<domain>__...") by "web:<domain>".
function appNameIndex(entries) {
  var index = ({})
  for (var i = 0; i < (entries || []).length; ++i) {
    var entry = entries[i]
    var name = String(entry.name || "")
    if (!name) continue
    if (entry.startupClass) index[String(entry.startupClass).toLowerCase()] = name
    if (entry.id) {
      // Window classes never carry the ".desktop" suffix, so index the id
      // without it; reverse-DNS ids ("org.gimp.GIMP") also answer to their
      // last label, for windows whose class is just the basename ("gimp").
      var idKey = String(entry.id).toLowerCase().replace(/\.desktop$/, "")
      if (idKey) index[idKey] = name
      var base = idKey.split(".").pop()
      if (base && base !== idKey && index[base] === undefined) index[base] = name
    }
    var url = String(entry.execString || "").match(/https?:\/\/([^\/"' ]+)/)
    if (url) index["web:" + url[1].toLowerCase().replace(/^www\./, "")] = name
  }
  return index
}

function appName(cls, index) {
  var lower = String(cls || "").toLowerCase()
  var web = lower.match(/^chrome-(.+?)__/)
  if (web) {
    var domain = web[1].replace(/^www\./, "")
    return index["web:" + domain] || capitalize(domain.split(".")[0])
  }
  if (lower === "soffice" || lower === "soffice.bin") return "LibreOffice"
  return index[lower] || index[lower.split(".").pop()] || capitalize(lower.split(".").pop())
}

// A Claude Code session ("✳ name", or a spinner while working) shows as the
// top bar shows it, a shell prompt ("user@host:~/dir") as its directory, and
// anything else (e.g. "nvim notes.md") as is. Other apps keep their name.
function windowLabel(cls, title, app) {
  if (TERMINAL_CLASSES.indexOf(String(cls || "").toLowerCase()) === -1) return app
  var text = String(title || "").trim()
  if (!text || text.toLowerCase() === String(cls).toLowerCase()) return app
  // Terminals that append their own name to the title ("… — Konsole") lose it.
  if (app) {
    var tail = " — " + app
    if (text.length > tail.length && text.slice(-tail.length).toLowerCase() === tail.toLowerCase())
      text = text.slice(0, -tail.length).trim()
  }
  if (!text) return app
  var prompt = text.match(/^[^@\s]+@[^:\s]+:\s*(.+)$/)
  // The prompt's trailing $, # or % is shell decoration, not the directory.
  if (prompt) return prompt[1].replace(/\s*[$#%]+$/, "") || app
  return text
}

// Every workspace that has windows, plus the visible ones, sorted by id, each
// with its windows as fractions of its monitor (floating ones last, so they
// draw on top). `state` is hyprctl's monitors, workspaces and clients;
// `waylandFor(address)` finds a window's toplevel for the live preview.
function buildWorkspaces(state, names, waylandFor) {
  var monitors = ({})
  var visible = ({})
  var focusedId = -1
  ;(state.monitors || []).forEach(function(m) {
    monitors[m.id] = { x: m.x, y: m.y, w: m.width / (m.scale || 1), h: m.height / (m.scale || 1) }
    if (m.activeWorkspace) visible[m.activeWorkspace.id] = true
    if (m.focused && m.activeWorkspace) focusedId = m.activeWorkspace.id
  })

  var byId = ({})
  ;(state.workspaces || []).forEach(function(w) {
    if (w.id <= 0) return
    if (w.windows === 0 && !visible[w.id]) return
    byId[w.id] = {
      id: w.id,
      name: String(w.name || w.id),
      monitor: monitors[w.monitorID] || { x: 0, y: 0, w: 1920, h: 1080 },
      visible: !!visible[w.id],
      focused: w.id === focusedId,
      windows: []
    }
  })

  ;(state.clients || []).forEach(function(c) {
    if (!c || c.mapped === false || c.hidden === true) return
    var ws = byId[c.workspace ? c.workspace.id : -1]
    if (!ws) return
    var address = normalizeAddress(c.address)
    if (!address) return
    // A client without usable geometry would poison the layout with NaN.
    if (!Array.isArray(c.at) || !Array.isArray(c.size)
      || typeof c.at[0] !== "number" || typeof c.at[1] !== "number"
      || typeof c.size[0] !== "number" || typeof c.size[1] !== "number") return
    var app = appName(c.class || c.initialClass, names)
    ws.windows.push({
      address: address,
      title: String(c.title || c.class || ""),
      app: app,
      label: windowLabel(c.class, c.title, app),
      x: (c.at[0] - ws.monitor.x) / ws.monitor.w,
      y: (c.at[1] - ws.monitor.y) / ws.monitor.h,
      w: c.size[0] / ws.monitor.w,
      h: c.size[1] / ws.monitor.h,
      floating: !!c.floating,
      wayland: waylandFor ? (waylandFor(address) || null) : null
    })
  })

  var list = Object.keys(byId).map(function(k) { return byId[k] })
  list.sort(function(a, b) { return a.id - b.id })
  list.forEach(function(ws) {
    ws.windows.sort(function(a, b) { return a.floating - b.floating })
  })
  return list
}

// Workspace ids, most recently focused first, with `id` moved to the front.
function touchRecent(recent, id) {
  if (!(id > 0)) return recent || []
  return [id].concat((recent || []).filter(function(other) { return other !== id }))
}

// The workspaces in order of visit: the focused one first, then the others by
// how recently they were focused, then any not focused since the shell
// started, by number.
function sortByRecent(workspaces, recent) {
  function rank(ws) {
    if (ws.focused) return -1
    var i = (recent || []).indexOf(ws.id)
    return i === -1 ? Infinity : i
  }
  return workspaces.slice().sort(function(a, b) {
    return rank(a) - rank(b) || a.id - b.id
  })
}

// The Lua run with `hyprctl eval` when the plugin loads, and again after every
// config reload (which drops runtime bindings). Alt + Tab cycles workspaces so
// Super + Tab stays free for this machine's window cycling. Letting go of Alt
// is a release binding on each Alt key that must see every release: transparent,
// or Hyprland shadows it once Alt + Tab has fired, so it never fires;
// non_consuming, so apps still see Alt; ignore_mods, so it fires with Shift
// held too. It has no description, so it stays out of the keybindings list.
function bindingScript(appId, owner) {
  function global(name) { return 'hl.dsp.global("' + appId + ':' + name + '")' }
  return [
    'hl.unbind("ALT + TAB")',
    'hl.unbind("ALT + SHIFT + TAB")',
    'hl.unbind("ALT + Alt_L")',
    'hl.unbind("ALT + Alt_R")',
    'hl.bind("ALT + TAB", ' + global("next") + ', { description = "Switch workspace (hold Alt)" })',
    'hl.bind("ALT + SHIFT + TAB", ' + global("previous") + ', { description = "Switch workspace backwards (hold Alt)" })',
    'for _, key in ipairs({ "Alt_L", "Alt_R" }) do hl.bind("ALT + " .. key, ' + global("commit")
      + ', { release = true, transparent = true, non_consuming = true, ignore_mods = true }) end',
    '_G.workspaceSwitcherBindingOwner = "' + owner + '"'
  ].join("; ")
}

// The Lua run when the plugin unloads: releases the Alt bindings it took,
// unless a newer instance has bound them since. Super + Tab is never touched,
// so this machine's window cycling survives enable and disable alike.
// (Upgrading from a version that took Super + Tab needs one `hyprctl reload`
// to clear the old runtime binds from the compositor.)
function restoreScript(owner) {
  return [
    'if _G.workspaceSwitcherBindingOwner == "' + owner + '" then',
    '_G.workspaceSwitcherBindingOwner = nil',
    'hl.unbind("ALT + TAB")',
    'hl.unbind("ALT + SHIFT + TAB")',
    'hl.unbind("ALT + Alt_L")',
    'hl.unbind("ALT + Alt_R")',
    'end'
  ].join(" ")
}

// Largest card width that fits n cards in the area, trying every column count.
function layoutFor(n, areaW, areaH, gap, labelHeight, cardAspect) {
  var best = { cols: 1, cardW: 0 }
  for (var cols = 1; cols <= n; ++cols) {
    var rows = Math.ceil(n / cols)
    var byWidth = (areaW - (cols - 1) * gap) / cols
    var byHeight = ((areaH - (rows - 1) * gap) / rows - labelHeight) * cardAspect
    var cardW = Math.min(byWidth, byHeight, areaW * 0.42)
    if (cardW > best.cardW) best = { cols: cols, cardW: cardW }
  }
  return best
}

// The card index after moving by dx columns and dy rows, or the same one if
// that would leave the grid.
function moveSelection(index, dx, dy, cols, count) {
  var next = index + dx + dy * cols
  return next >= 0 && next < count ? next : index
}

// The card index after stepping through the cards in order, as Super + Tab
// does, wrapping around at either end.
function cycleSelection(index, step, count) {
  if (count <= 0) return 0
  return ((index + step) % count + count) % count
}

// Where letting go of Super leads: the selected workspace, or nowhere if the
// overview hadn't opened yet or the current workspace is still selected.
function commitTarget(opened, workspaces, index) {
  var ws = opened && workspaces ? workspaces[index] : null
  return ws && !ws.focused ? ws : null
}

// The card that is highlighted, and that Return or letting go of Super goes
// to: the one under the pointer while it is over one, otherwise the one the
// keyboard selected. Leaving a card hands the highlight back.
function highlightIndex(selected, hovered) {
  return hovered >= 0 ? hovered : selected
}

// Whether the pointer has really moved since the overview opened: one resting
// where a card appears doesn't hover it until it moves a few pixels.
function pointerMoved(start, x, y, threshold) {
  if (!start) return false
  return Math.abs(x - start.x) > threshold || Math.abs(y - start.y) > threshold
}

if (typeof module !== "undefined") {
  module.exports = {
    normalizeAddress: normalizeAddress,
    capitalize: capitalize,
    appNameIndex: appNameIndex,
    appName: appName,
    windowLabel: windowLabel,
    buildWorkspaces: buildWorkspaces,
    touchRecent: touchRecent,
    bindingScript: bindingScript,
    restoreScript: restoreScript,
    sortByRecent: sortByRecent,
    layoutFor: layoutFor,
    moveSelection: moveSelection,
    cycleSelection: cycleSelection,
    commitTarget: commitTarget,
    highlightIndex: highlightIndex,
    pointerMoved: pointerMoved
  }
}
