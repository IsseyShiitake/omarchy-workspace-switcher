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

// typeof NaN and Infinity is "number", so a plain typeof check lets them
// through. JSON.parse only produces Infinity for an out-of-range literal, but
// the layout arithmetic turns either one into NaN fractions.
function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value)
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
    if (!entry) continue
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
  var s = state || {}
  var monitors = ({})
  var visible = ({})
  var focusedId = -1
  // state is JSON.parse of hyprctl output, so these are normally arrays; a
  // wrong-shaped (but non-null) object must yield no cards, not a TypeError.
  ;(Array.isArray(s.monitors) ? s.monitors : []).forEach(function(m) {
    if (!m || !isFiniteNumber(m.id) || !isFiniteNumber(m.x) || !isFiniteNumber(m.y)
      || !isFiniteNumber(m.width) || !isFiniteNumber(m.height)) return
    monitors[m.id] = { x: m.x, y: m.y, w: m.width / (m.scale || 1), h: m.height / (m.scale || 1) }
    if (m.activeWorkspace) visible[m.activeWorkspace.id] = true
    if (m.focused && m.activeWorkspace) focusedId = m.activeWorkspace.id
  })

  var byId = ({})
  ;(Array.isArray(s.workspaces) ? s.workspaces : []).forEach(function(w) {
    if (!w || !(w.id > 0)) return
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

  ;(Array.isArray(s.clients) ? s.clients : []).forEach(function(c) {
    if (!c || c.mapped === false || c.hidden === true) return
    var ws = byId[c.workspace ? c.workspace.id : -1]
    if (!ws) return
    var address = normalizeAddress(c.address)
    if (!address) return
    // A client without usable geometry would poison the layout with NaN.
    if (!Array.isArray(c.at) || !Array.isArray(c.size)
      || !isFiniteNumber(c.at[0]) || !isFiniteNumber(c.at[1])
      || !isFiniteNumber(c.size[0]) || !isFiniteNumber(c.size[1])) return
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
      wayland: waylandFor ? (waylandFor(address) || null) : null,
      // Filled in by assignCaptureOrder when the overview opens; -1 = not
      // scheduled for a capture yet.
      captureOrder: -1
    })
  })

  var list = Object.keys(byId).map(function(k) { return byId[k] })
  list.sort(function(a, b) { return a.id - b.id })
  list.forEach(function(ws) {
    // Two ordered passes, not a sort: "floating" compares equal for every
    // tiled window (and for every floating one), and Qt's V4 engine does not
    // sort equal elements stably, so a sort would scramble hyprctl's order
    // inside each group. Tiled first, then floating, each in input order.
    var tiled = []
    var floating = []
    for (var i = 0; i < ws.windows.length; ++i)
      (ws.windows[i].floating ? floating : tiled).push(ws.windows[i])
    ws.windows = tiled.concat(floating)
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

// The cards in display order: plain number order when numericOrder is set,
// otherwise order of visit. Same workspace objects, only the order differs,
// so a selection computed in one order maps onto the other by identity.
function displayOrder(workspaces, recent, numericOrder) {
  if (numericOrder) return workspaces.slice().sort(function(a, b) { return a.id - b.id })
  return sortByRecent(workspaces, recent)
}

// The display position the overview opens with: the card Tab would reach from
// the focused one in visit order (first Tab = last-visited workspace), mapped
// onto however the cards are displayed. `ranked` is the visit-ordered list.
function initialSelection(ranked, display, pendingSteps) {
  var target = (ranked || [])[cycleSelection(0, pendingSteps, (ranked || []).length)]
  return Math.max(0, (display || []).indexOf(target))
}

// Numbers the windows for the staggered capture pump: the focused workspace's
// windows first (they are what the user is looking at), then the other cards
// in display order. Every window gets exactly one slot; the return value is
// how many captures the pump has to issue.
function assignCaptureOrder(cards) {
  var order = 0
  var list = cards || []
  // Ordered passes, not a sort: a comparator on "focused" alone compares
  // equal for every other card, and Qt 6.11's V4 engine does not sort equal
  // elements stably (Node does), so a sort scrambled the display order this
  // function promises in the running shell. Focused cards keep their order,
  // then every other card keeps its own.
  for (var pass = 0; pass < 2; ++pass) {
    for (var i = 0; i < list.length; ++i) {
      var card = list[i]
      if (!card || (pass === 0 ? !card.focused : !!card.focused)) continue
      var windows = card.windows ? card.windows : []
      for (var j = 0; j < windows.length; ++j) windows[j].captureOrder = order++
    }
  }
  return order
}

// How many windows can actually be captured: a window whose toplevel the shell
// cannot resolve never reports preview content, so the preview wait must count
// only the rest or it would always run out its full timeout.
function countCaptureTargets(cards) {
  var count = 0
  for (var i = 0; i < (cards || []).length; ++i) {
    var windows = cards[i] && cards[i].windows ? cards[i].windows : []
    for (var j = 0; j < windows.length; ++j) if (windows[j].wayland) count += 1
  }
  return count
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
// that would leave the grid. Left and right stop at the edge of the row, up
// and down at the edge of the grid: a walk never wraps into the neighbouring
// row, which is what the vertical arrows are for.
function moveSelection(index, dx, dy, cols, count) {
  if (!(cols > 0)) return index
  var col = index % cols
  if (dx < 0 && col === 0) dx = 0
  if (dx > 0 && col === cols - 1) dx = 0
  var next = index + dx + dy * cols
  return next >= 0 && next < count ? next : index
}

// Settings from ~/.config/omarchy/workspace-switcher.json. Absent file,
// missing keys or malformed JSON all fall back to the defaults (everything
// on); "off" values revert that behavior to how the base plugin ships.
// captureStaggerMs is how long the capture pump waits between two previews;
// it is clamped to a sane range so a typo cannot stall the previews forever.
function parseSettings(text) {
  var out = { gestureOpen: true, accentTint: true, numericOrder: true, captureStaggerMs: 8, previewWaitMs: 0 }
  if (!text) return out
  try {
    var data = JSON.parse(String(text))
    if (data && typeof data.gestureOpen === "boolean") out.gestureOpen = data.gestureOpen
    if (data && typeof data.accentTint === "boolean") out.accentTint = data.accentTint
    if (data && typeof data.numericOrder === "boolean") out.numericOrder = data.numericOrder
    if (data && typeof data.captureStaggerMs === "number" && isFinite(data.captureStaggerMs))
      out.captureStaggerMs = Math.min(500, Math.max(0, Math.round(data.captureStaggerMs)))
    if (data && typeof data.previewWaitMs === "number" && isFinite(data.previewWaitMs))
      out.previewWaitMs = Math.min(1000, Math.max(0, Math.round(data.previewWaitMs)))
  } catch (error) {
    // malformed: keep defaults
  }
  return out
}

// One line of the input stream the Lua side in hyprland.lua writes to
// /tmp/omarchy-workspace-switcher-swipe. Two kinds:
//   "begin up" / "update up -123.45" / "end down [cancelled]" — gesture
//     phases; `dy` is the finger travel accumulated by the Lua side (screen
//     coordinates: swiping up makes it negative), present on updates only;
//     "cancelled" marks a gesture the compositor aborted, which reverts
//     instead of committing.
//   "key next" — a key press from the Lua-function binds (next, previous,
//     commit, toggle, close).
function parseSwipe(line) {
  var parts = String(line || "").trim().split(/\s+/)
  if (parts.length < 2) return null
  if (parts[0] === "key") {
    if (["next", "previous", "commit", "toggle", "close"].indexOf(parts[1]) === -1) return null
    return { phase: "key", name: parts[1] }
  }
  if (parts[0] !== "begin" && parts[0] !== "update" && parts[0] !== "end") return null
  // The stream only ever carries up and down. Anything else is a line from
  // something else (or a corrupted one) and must not be read as a gesture:
  // an unknown direction read as "up" would open the overview.
  if (parts[1] !== "up" && parts[1] !== "down") return null
  var event = { phase: parts[0], dir: parts[1], dy: 0, cancelled: false }
  if (parts[0] === "update") {
    var dy = parseFloat(parts[2])
    if (isNaN(dy)) return null
    event.dy = dy
  }
  if (parts[0] === "end" && parts[2] === "cancelled") event.cancelled = true
  return event
}

function clamp01(value) {
  return value < 0 ? 0 : (value > 1 ? 1 : value)
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
    sortByRecent: sortByRecent,
    displayOrder: displayOrder,
    assignCaptureOrder: assignCaptureOrder,
    countCaptureTargets: countCaptureTargets,
    initialSelection: initialSelection,
    layoutFor: layoutFor,
    moveSelection: moveSelection,
    cycleSelection: cycleSelection,
    commitTarget: commitTarget,
    highlightIndex: highlightIndex,
    pointerMoved: pointerMoved,
    parseSettings: parseSettings,
    parseSwipe: parseSwipe,
    clamp01: clamp01
  }
}
