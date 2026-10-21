// Audit suite: exhaustive edge-case coverage of every function exported by
// WorkspaceSwitcherLogic.js, plus a source-level invariant check on the QML.
//
// Run with: node test/audit-test.js
//
// Unlike test/logic-test.js (which pins the intended behaviour), this file is
// written to *fail loudly* on defects: each block states the invariant it
// checks. A failure here is a finding, not a flaky test.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const L = require("../WorkspaceSwitcherLogic.js")

const failures = []
let checks = 0
function check(name, fn) {
  checks += 1
  try {
    fn()
  } catch (error) {
    failures.push({ name, error })
  }
}
function section(title) {
  console.log("- " + title)
}

// ---------------------------------------------------------------------------
section("normalizeAddress: every shape hyprctl and quickshell can hand over")
check("lowercases and prefixes 0x", () => {
  assert.equal(L.normalizeAddress("0x5612EE77D1C0"), "0x5612ee77d1c0")
  assert.equal(L.normalizeAddress("5612ee77d1c0"), "0x5612ee77d1c0")
  assert.equal(L.normalizeAddress("0X5612EE77D1C0"), "0x5612ee77d1c0")
})
check("rejects anything that is not hex", () => {
  assert.equal(L.normalizeAddress("0x"), "")
  assert.equal(L.normalizeAddress("0xZZ"), "")
  assert.equal(L.normalizeAddress("0x1234g"), "")
  assert.equal(L.normalizeAddress("not-an-address"), "")
  assert.equal(L.normalizeAddress("0x12 34"), "")
})
check("survives null/undefined/numbers without throwing", () => {
  assert.equal(L.normalizeAddress(null), "")
  assert.equal(L.normalizeAddress(undefined), "")
  assert.equal(L.normalizeAddress(""), "")
  assert.equal(L.normalizeAddress(0), "")
  // A number is a valid hex address: 123 -> 0x123.
  assert.equal(L.normalizeAddress(123), "0x123")
})
check("is idempotent", () => {
  const a = L.normalizeAddress("5612EE77D1C0")
  assert.equal(L.normalizeAddress(a), a)
})

// ---------------------------------------------------------------------------
section("capitalize")
check("upper-cases the first letter, never throws on empty", () => {
  assert.equal(L.capitalize("konsole"), "Konsole")
  assert.equal(L.capitalize("a"), "A")
  assert.equal(L.capitalize(""), "Window")
  assert.equal(L.capitalize(null), "Window")
  assert.equal(L.capitalize(undefined), "Window")
  assert.equal(L.capitalize("ALLCAPS"), "ALLCAPS")
})

// ---------------------------------------------------------------------------
section("appNameIndex: desktop entries -> lookup table")
const index = L.appNameIndex([
  { name: "GNU Image Manipulation Program", id: "org.gimp.GIMP.desktop" },
  { name: "Firefox Web Browser", id: "firefox.desktop" },
  { name: "Konsole", id: "org.kde.konsole.desktop", startupClass: "konsole" },
  { name: "Zen Browser", id: "app.zen_browser.zen.desktop", execString: "zen %U" },
  { name: "Github", id: "github.desktop", execString: "/usr/bin/github https://github.com" },
])
check("indexes the id without the .desktop suffix", () => {
  assert.equal(index["firefox"], "Firefox Web Browser")
  assert.equal(index["org.gimp.gimp"], "GNU Image Manipulation Program")
})
check("indexes the reverse-DNS basename as a fallback", () => {
  assert.equal(index["gimp"], "GNU Image Manipulation Program")
  assert.equal(index["konsole"], "Konsole")
})
check("never indexes a junk 'desktop' key", () => {
  assert.equal(index["desktop"], undefined)
})
check("indexes web apps by domain", () => {
  assert.equal(index["web:github.com"], "Github")
})
check("survives junk entries", () => {
  const junk = L.appNameIndex([{}, { name: "" }, { name: "X" }])
  assert.equal(typeof junk, "object")
  assert.equal(Object.keys(junk).length, 0)
  // A null entry must not take the whole index down with it.
  L.appNameIndex([{ name: "A" }, null, { name: "B" }])
})
check("handles a null/undefined list", () => {
  assert.deepEqual(L.appNameIndex(null), {})
  assert.deepEqual(L.appNameIndex(undefined), {})
  assert.deepEqual(L.appNameIndex([]), {})
})

// ---------------------------------------------------------------------------
section("appName: class -> human name")
check("uses the index, then the basename, then a capitalised fallback", () => {
  assert.equal(L.appName("firefox", index), "Firefox Web Browser")
  assert.equal(L.appName("gimp", index), "GNU Image Manipulation Program")
  assert.equal(L.appName("org.kde.konsole", index), "Konsole")
  assert.equal(L.appName("unknownapp", index), "Unknownapp")
  assert.equal(L.appName("", index), "Window")
  assert.equal(L.appName(null, index), "Window")
})
check("maps the LibreOffice wrappers", () => {
  assert.equal(L.appName("soffice", index), "LibreOffice")
  assert.equal(L.appName("soffice.bin", index), "LibreOffice")
})
check("maps a Chromium web app by its domain", () => {
  assert.equal(L.appName("chrome-github.com__-Default", index), "Github")
  // No entry: fall back to the domain's first label.
  assert.equal(L.appName("chrome-example.org__-Default", index), "Example")
  assert.equal(L.appName("chrome-www.example.org__-Default", index), "Example")
})

// ---------------------------------------------------------------------------
section("windowLabel: terminal titles")
check("non-terminals keep their app name", () => {
  assert.equal(L.windowLabel("chromium", "Inbox", "Chromium"), "Chromium")
  assert.equal(L.windowLabel("", "Inbox", "Chromium"), "Chromium")
})
check("a terminal shows its prompt directory", () => {
  assert.equal(L.windowLabel("foot", "me@host:~/code", "Foot"), "~/code")
  assert.equal(L.windowLabel("foot", "me@host:~/code$", "Foot"), "~/code")
  assert.equal(L.windowLabel("foot", "me@host:~/code#", "Foot"), "~/code")
  assert.equal(L.windowLabel("foot", "me@host:~/code%", "Foot"), "~/code")
})
check("a terminal shows a Claude Code session name", () => {
  assert.equal(L.windowLabel("foot", "✳ Fix the build", "Foot"), "✳ Fix the build")
})
check("a terminal shows the running program", () => {
  assert.equal(L.windowLabel("foot", "nvim notes.md", "Foot"), "nvim notes.md")
})
check("a terminal's own suffix is stripped", () => {
  assert.equal(L.windowLabel("konsole", "me@host:~/code — Konsole", "Konsole"), "~/code")
  assert.equal(L.windowLabel("konsole", "nvim notes.md — Konsole", "Konsole"), "nvim notes.md")
})
check("an empty or self-titled terminal falls back to the app name", () => {
  assert.equal(L.windowLabel("foot", "", "Foot"), "Foot")
  assert.equal(L.windowLabel("foot", "   ", "Foot"), "Foot")
  assert.equal(L.windowLabel("foot", "foot", "Foot"), "Foot")
  assert.equal(L.windowLabel("foot", "FOOT", "Foot"), "Foot")
})
check("every terminal class in the list is recognised", () => {
  const terminals = ["foot", "footclient", "alacritty", "kitty", "com.mitchellh.ghostty",
    "konsole", "org.kde.konsole", "gnome-terminal-server", "org.gnome.terminal",
    "xterm", "wezterm", "org.wezfurlong.wezterm", "terminator"]
  for (const cls of terminals) {
    assert.equal(L.windowLabel(cls, "me@host:~/x", "App"), "~/x", cls + " not treated as a terminal")
  }
})
check("the class match is case-insensitive", () => {
  assert.equal(L.windowLabel("Foot", "me@host:~/x", "App"), "~/x")
  assert.equal(L.windowLabel("ORG.KDE.KONSOLE", "me@host:~/x", "App"), "~/x")
})
check("a title that is only the class name is not a label", () => {
  assert.equal(L.windowLabel("Konsole", "Konsole", "Konsole"), "Konsole")
})

// ---------------------------------------------------------------------------
section("buildWorkspaces: hyprctl state -> cards")
const monitor = { id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1,
  activeWorkspace: { id: 1 }, focused: true }
function state(over) {
  return Object.assign({
    monitors: [monitor],
    workspaces: [{ id: 1, name: "1", monitorID: 0, windows: 1 }],
    clients: [{ address: "0x1", class: "foot", title: "t", at: [0, 0], size: [100, 100],
      workspace: { id: 1 } }],
  }, over || {})
}
check("a client lands on its workspace, as monitor fractions", () => {
  const list = L.buildWorkspaces(state({
    clients: [{ address: "0x1", class: "foot", title: "t", at: [192, 108], size: [960, 540],
      workspace: { id: 1 } }],
  }), {}, null)
  assert.equal(list.length, 1)
  const w = list[0].windows[0]
  assert.equal(w.x, 0.1)
  assert.equal(w.y, 0.1)
  assert.equal(w.w, 0.5)
  assert.equal(w.h, 0.5)
})
check("scale is divided out of the monitor size", () => {
  // hyprctl reports client geometry in logical pixels, so a full-screen client
  // on a 2880x1800 @2 monitor is 1440x900.
  const list = L.buildWorkspaces(state({
    monitors: [{ id: 0, x: 0, y: 0, width: 2880, height: 1800, scale: 2,
      activeWorkspace: { id: 1 }, focused: true }],
    clients: [{ address: "0x1", class: "foot", title: "t", at: [0, 0], size: [1440, 900],
      workspace: { id: 1 } }],
  }), {}, null)
  assert.equal(list[0].windows[0].w, 1)
  assert.equal(list[0].windows[0].h, 1)
})
check("empty, never-visited workspaces are left out", () => {
  const list = L.buildWorkspaces(state({
    workspaces: [{ id: 1, name: "1", monitorID: 0, windows: 1 },
      { id: 2, name: "2", monitorID: 0, windows: 0 }],
  }), {}, null)
  assert.deepEqual(list.map((w) => w.id), [1])
})
check("an empty but visible workspace is kept", () => {
  const list = L.buildWorkspaces(state({
    monitors: [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1,
      activeWorkspace: { id: 2 }, focused: true }],
    workspaces: [{ id: 1, name: "1", monitorID: 0, windows: 1 },
      { id: 2, name: "2", monitorID: 0, windows: 0 }],
  }), {}, null)
  assert.deepEqual(list.map((w) => w.id), [1, 2])
  assert.equal(list[1].visible, true)
  assert.equal(list[1].focused, true)
})
check("special (negative id) workspaces are excluded", () => {
  const list = L.buildWorkspaces(state({
    workspaces: [{ id: 1, name: "1", monitorID: 0, windows: 1 },
      { id: -99, name: "special:magic", monitorID: 0, windows: 2 }],
  }), {}, null)
  assert.deepEqual(list.map((w) => w.id), [1])
})
check("unmapped and hidden clients are excluded", () => {
  const list = L.buildWorkspaces(state({
    clients: [
      { address: "0x1", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 } },
      { address: "0x2", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 }, mapped: false },
      { address: "0x3", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 }, hidden: true },
    ],
  }), {}, null)
  assert.equal(list[0].windows.length, 1)
})
check("a client with broken geometry is skipped, not NaN-poisoned", () => {
  const list = L.buildWorkspaces(state({
    clients: [
      { address: "0x1", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 } },
      { address: "0x2", class: "foot", title: "t", workspace: { id: 1 } },
      { address: "0x3", class: "foot", title: "t", at: ["x", 0], size: [10, 10], workspace: { id: 1 } },
      { address: "0x4", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 } },
    ],
  }), {}, null)
  assert.equal(list[0].windows.length, 2)
  for (const w of list[0].windows) {
    assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y)
      && Number.isFinite(w.w) && Number.isFinite(w.h), "non-finite geometry")
  }
})
check("NaN and Infinity geometry is rejected, not just non-numbers", () => {
  // typeof NaN is "number" and JSON.parse turns 1e999 into Infinity, so a
  // typeof-only guard would let both through and NaN-poison the card.
  const clients = [
    { address: "0x1", at: [NaN, 0], size: [10, 10] },
    { address: "0x2", at: [0, Infinity], size: [10, 10] },
    { address: "0x3", at: [0, 0], size: [NaN, 10] },
    { address: "0x4", at: [0, 0], size: [10, Infinity] },
    { address: "0x5", at: [0, 0], size: [10, 10] },
  ].map((c) => Object.assign({ class: "foot", title: "t", workspace: { id: 1 } }, c))
  const list = L.buildWorkspaces(state({ clients }), {}, null)
  assert.equal(list[0].windows.length, 1)
  assert.equal(list[0].windows[0].address, "0x5")
})
check("a wrong-shaped state yields no cards instead of throwing", () => {
  for (const s of [{ monitors: {} }, { workspaces: {} }, { clients: {} },
    { monitors: "x" }, { monitors: [null] }, { workspaces: [null] }, { clients: [null] }]) {
    assert.deepEqual(L.buildWorkspaces(s, {}, null), [], JSON.stringify(s))
  }
  assert.deepEqual(L.buildWorkspaces(5, {}, null), [])
})
check("a monitor with non-finite geometry falls back to the default grid", () => {
  const list = L.buildWorkspaces(state({
    monitors: [{ id: 0, x: 0, y: 0, width: NaN, height: 1080, scale: 1,
      activeWorkspace: { id: 1 }, focused: true }],
  }), {}, null)
  assert.equal(list[0].monitor.w, 1920)
  assert.equal(list[0].monitor.h, 1080)
})
check("a client on a workspace that is not listed is dropped", () => {
  const list = L.buildWorkspaces(state({
    clients: [{ address: "0x9", class: "foot", title: "t", at: [0, 0], size: [10, 10],
      workspace: { id: 42 } }],
  }), {}, null)
  assert.equal(list[0].windows.length, 0)
})
check("a client without an address is dropped", () => {
  const list = L.buildWorkspaces(state({
    clients: [{ address: "", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 } }],
  }), {}, null)
  assert.equal(list[0].windows.length, 0)
})
check("a client whose monitor is missing falls back to a 1920x1080 grid", () => {
  const list = L.buildWorkspaces(state({
    monitors: [{ id: 3, x: 0, y: 0, width: 1920, height: 1080, scale: 1,
      activeWorkspace: { id: 1 }, focused: true }],
    workspaces: [{ id: 1, name: "1", monitorID: 99, windows: 1 }],
  }), {}, null)
  assert.equal(list[0].monitor.w, 1920)
  assert.equal(list[0].monitor.h, 1080)
})
check("floating windows sort last, so they draw on top", () => {
  const list = L.buildWorkspaces(state({
    clients: [
      { address: "0x1", class: "foot", title: "f", at: [0, 0], size: [10, 10], workspace: { id: 1 }, floating: true },
      { address: "0x2", class: "foot", title: "t", at: [0, 0], size: [10, 10], workspace: { id: 1 } },
    ],
  }), {}, null)
  assert.equal(list[0].windows[0].floating, false)
  assert.equal(list[0].windows[1].floating, true)
})
check("the floating partition keeps hyprctl order within each group", () => {
  // A sort by "floating" would reorder the equal elements on Qt's V4 engine;
  // two passes pin tiled-first, then floating, each in input order.
  const clients = [
    { address: "0x1", floating: false }, { address: "0x2", floating: true },
    { address: "0x3", floating: false }, { address: "0x4", floating: true },
    { address: "0x5", floating: false },
  ].map((c) => Object.assign({ class: "foot", title: "t", at: [0, 0], size: [10, 10],
    workspace: { id: 1 } }, c))
  const list = L.buildWorkspaces(state({ clients }), {}, null)
  assert.deepEqual(list[0].windows.map((w) => w.address),
    ["0x1", "0x3", "0x5", "0x2", "0x4"])
})
check("the wayland surface is looked up per address", () => {
  const list = L.buildWorkspaces(state({
    clients: [{ address: "0x1", class: "foot", title: "t", at: [0, 0], size: [10, 10],
      workspace: { id: 1 } }],
  }), {}, (address) => (address === "0x1" ? { surface: true } : null))
  assert.deepEqual(list[0].windows[0].wayland, { surface: true })
})
check("every window starts with captureOrder -1", () => {
  const list = L.buildWorkspaces(state(), {}, null)
  assert.equal(list[0].windows[0].captureOrder, -1)
})
check("the list is sorted by workspace id", () => {
  const list = L.buildWorkspaces(state({
    workspaces: [{ id: 7, name: "7", monitorID: 0, windows: 1 },
      { id: 2, name: "2", monitorID: 0, windows: 1 },
      { id: 1, name: "1", monitorID: 0, windows: 1 }],
    monitors: [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1,
      activeWorkspace: { id: 7 }, focused: true }],
  }), {}, null)
  assert.deepEqual(list.map((w) => w.id), [1, 2, 7])
})
check("an empty state yields an empty list", () => {
  assert.deepEqual(L.buildWorkspaces({ monitors: [], workspaces: [], clients: [] }, {}, null), [])
  // A missing state must not take the overview down.
  assert.deepEqual(L.buildWorkspaces(null, {}, null), [])
})
check("the live fixture builds without throwing and stays consistent", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture-live-state.json"), "utf8"))
  const list = L.buildWorkspaces(fixture, {}, (address) => ({ address }))
  assert.ok(list.length > 0, "live fixture produced no workspaces")
  for (const ws of list) {
    for (const w of ws.windows) {
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y)
        && Number.isFinite(w.w) && Number.isFinite(w.h))
      assert.ok(w.x >= -1 && w.x <= 1, "x out of the monitor: " + w.x)
      assert.ok(w.w >= 0 && w.w <= 1, "w out of the monitor: " + w.w)
    }
  }
})

// ---------------------------------------------------------------------------
section("touchRecent / sortByRecent / displayOrder")
check("touchRecent keeps the most recent first, without duplicates", () => {
  let recent = []
  for (const id of [1, 3, 5, 3, 2]) recent = L.touchRecent(recent, id)
  assert.deepEqual(recent, [2, 3, 5, 1])
})
check("touchRecent ignores non-positive ids", () => {
  assert.deepEqual(L.touchRecent([1], 0), [1])
  assert.deepEqual(L.touchRecent([1], -1), [1])
  assert.deepEqual(L.touchRecent(null, 2), [2])
  assert.deepEqual(L.touchRecent(undefined, 2), [2])
})
check("sortByRecent puts the focused one first, then by visit, then by id", () => {
  const ws = [1, 2, 3, 5, 7, 8].map((id) => ({ id, focused: id === 3 }))
  assert.deepEqual(L.sortByRecent(ws, [2, 3, 5, 1]).map((w) => w.id), [3, 2, 5, 1, 7, 8])
})
check("sortByRecent does not mutate its input", () => {
  const ws = [1, 2, 3].map((id) => ({ id, focused: false }))
  const copy = ws.slice()
  L.sortByRecent(ws, [3])
  assert.deepEqual(ws, copy)
})
check("two unvisited workspaces keep numeric order (no NaN in the comparator)", () => {
  const ws = [9, 4].map((id) => ({ id, focused: false }))
  assert.deepEqual(L.sortByRecent(ws, []).map((w) => w.id), [4, 9])
})
check("displayOrder switches between number order and visit order", () => {
  const cards = [3, 1, 2, 4].map((id) => ({ id, focused: id === 3 }))
  assert.deepEqual(L.displayOrder(cards, [2, 4, 1], true).map((w) => w.id), [1, 2, 3, 4])
  assert.deepEqual(L.displayOrder(cards, [2, 4, 1], false).map((w) => w.id), [3, 2, 4, 1])
})
check("displayOrder keeps the same objects (identity, not a copy)", () => {
  const cards = [3, 1, 2].map((id) => ({ id, focused: false }))
  const out = L.displayOrder(cards, [1], true)
  assert.equal(out[0], cards[1])
})

// ---------------------------------------------------------------------------
section("initialSelection: the card the overview opens on")
const selCards = [3, 1, 2, 4].map((id) => ({ id, focused: id === 3 }))
const selRanked = L.sortByRecent(selCards, [2, 4, 1])
const selNumeric = L.displayOrder(selCards, [2, 4, 1], true)
check("one step forward lands on the last-visited card", () => {
  assert.equal(selNumeric[L.initialSelection(selRanked, selNumeric, 1)].id, 2)
})
check("one step back lands on the least recent card", () => {
  assert.equal(selNumeric[L.initialSelection(selRanked, selNumeric, -1)].id, 1)
})
check("no step lands on the focused card", () => {
  assert.equal(selNumeric[L.initialSelection(selRanked, selNumeric, 0)].id, 3)
})
check("the index is always inside the display list", () => {
  for (let step = -6; step <= 6; ++step) {
    const i = L.initialSelection(selRanked, selNumeric, step)
    assert.ok(i >= 0 && i < selNumeric.length, "index " + i + " out of range for step " + step)
  }
})
check("an empty list is safe", () => {
  assert.equal(L.initialSelection([], [], 1), 0)
  assert.equal(L.initialSelection(null, null, 1), 0)
})

// ---------------------------------------------------------------------------
section("assignCaptureOrder / countCaptureTargets")
check("the focused card captures first, then the cards in display order", () => {
  // Ordered passes, not a sort: Node's sort is stable, but Qt 6.11.2's V4
  // engine is not (an all-equal comparator reorders the array), so a sort
  // would scramble this in the running shell. Four cards with three
  // non-focused ones pin the order a sort would have been free to change.
  const pump = [
    { id: 1, focused: false, windows: [{}, {}] },
    { id: 2, focused: false, windows: [{}] },
    { id: 3, focused: true, windows: [{}] },
    { id: 4, focused: false, windows: [{}] },
  ]
  assert.equal(L.assignCaptureOrder(pump), 5)
  assert.deepEqual(pump[2].windows.map((w) => w.captureOrder), [0])
  assert.deepEqual(pump[0].windows.map((w) => w.captureOrder), [1, 2])
  assert.deepEqual(pump[1].windows.map((w) => w.captureOrder), [3])
  assert.deepEqual(pump[3].windows.map((w) => w.captureOrder), [4])
})
check("without a focused card every card keeps its display order", () => {
  const cards = [
    { id: 1, windows: [{}] },
    { id: 2, windows: [{}] },
    { id: 3, windows: [{}] },
  ]
  assert.equal(L.assignCaptureOrder(cards), 3)
  assert.deepEqual(cards.map((c) => c.windows[0].captureOrder), [0, 1, 2])
})
check("every window gets exactly one slot, no gaps and no duplicates", () => {
  const cards = []
  for (let c = 0; c < 5; ++c) {
    cards.push({ id: c, focused: c === 2, windows: Array.from({ length: c % 3 }, () => ({})) })
  }
  const total = L.assignCaptureOrder(cards)
  const slots = cards.flatMap((c) => c.windows.map((w) => w.captureOrder)).sort((a, b) => a - b)
  assert.equal(total, slots.length)
  assert.deepEqual(slots, Array.from({ length: total }, (_, i) => i))
})
check("empty and malformed inputs are safe", () => {
  assert.equal(L.assignCaptureOrder([]), 0)
  assert.equal(L.assignCaptureOrder(null), 0)
  assert.equal(L.assignCaptureOrder([{ id: 1, focused: true }]), 0)
  assert.equal(L.assignCaptureOrder([{ id: 1, focused: true, windows: null }]), 0)
})
check("only windows with a toplevel count as capture targets", () => {
  const targets = [
    { id: 1, focused: true, windows: [{ wayland: {} }, { wayland: null }] },
    { id: 2, focused: false, windows: [{ wayland: {} }] },
    { id: 3, focused: false, windows: [] },
  ]
  assert.equal(L.countCaptureTargets(targets), 2)
  assert.equal(L.countCaptureTargets([]), 0)
  assert.equal(L.countCaptureTargets(null), 0)
  assert.equal(L.countCaptureTargets([{ id: 1, windows: [{ wayland: null }] }]), 0)
})

// ---------------------------------------------------------------------------
section("layoutFor: the grid that fits")
check("picks the column count with the largest card", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 8, 12]) {
    const fit = L.layoutFor(n, 1200, 800, 10, 20, 16 / 9)
    let best = 0
    let bestCols = 1
    for (let cols = 1; cols <= n; ++cols) {
      const rows = Math.ceil(n / cols)
      const byWidth = (1200 - (cols - 1) * 10) / cols
      const byHeight = ((800 - (rows - 1) * 10) / rows - 20) * (16 / 9)
      const w = Math.min(byWidth, byHeight, 1200 * 0.42)
      if (w > best) { best = w; bestCols = cols }
    }
    assert.ok(Math.abs(fit.cardW - best) < 1e-9, "n=" + n + ": cardW " + fit.cardW + " != " + best)
    assert.equal(fit.cols, bestCols, "n=" + n + ": cols " + fit.cols + " != " + bestCols)
  }
})
check("the card never exceeds the 42% width cap", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 8, 12, 30]) {
    const fit = L.layoutFor(n, 1200, 800, 10, 20, 16 / 9)
    assert.ok(fit.cardW <= 1200 * 0.42 + 1e-9, "n=" + n + " above the cap")
  }
})
check("one card is capped at 42% of the area", () => {
  assert.deepEqual(L.layoutFor(1, 1000, 700, 10, 20, 16 / 9), { cols: 1, cardW: 420 })
})
check("a degenerate area does not produce a negative card", () => {
  const fit = L.layoutFor(4, 100, 10, 10, 20, 16 / 9)
  assert.ok(fit.cardW >= 0, "negative card width")
  assert.ok(fit.cols >= 1)
})
check("zero cards is a safe degenerate case", () => {
  assert.deepEqual(L.layoutFor(0, 1000, 700, 10, 20, 16 / 9), { cols: 1, cardW: 0 })
})

// ---------------------------------------------------------------------------
section("moveSelection: arrow-key navigation")
check("arrows move within the grid", () => {
  assert.equal(L.moveSelection(1, 1, 0, 3, 6), 2)
  assert.equal(L.moveSelection(2, -1, 0, 3, 6), 1)
  assert.equal(L.moveSelection(2, 0, 1, 3, 6), 5)
  assert.equal(L.moveSelection(4, 0, -1, 3, 6), 1)
})
check("the edges stop the walk", () => {
  assert.equal(L.moveSelection(5, 1, 0, 3, 6), 5)
  assert.equal(L.moveSelection(0, 0, -1, 3, 6), 0)
  assert.equal(L.moveSelection(4, 0, 1, 3, 6), 4)
})
check("a left arrow at the start of a row stays on the row", () => {
  // Documented as "the same one if that would leave the grid": index 3 is the
  // first card of the second row, so -1 would land on index 2, the LAST card
  // of the first row - a different card, in a different row.
  assert.equal(L.moveSelection(3, -1, 0, 3, 6), 3,
    "left at a row start wraps into the previous row")
})
check("a right arrow at the end of a row stays on the row", () => {
  // index 2 is the last card of the first row; +1 would be index 3, the first
  // card of the second row.
  assert.equal(L.moveSelection(2, 1, 0, 3, 6), 2,
    "right at a row end wraps into the next row")
})

// ---------------------------------------------------------------------------
section("cycleSelection / commitTarget / highlightIndex / pointerMoved")
check("cycling wraps at both ends", () => {
  assert.equal(L.cycleSelection(0, 1, 6), 1)
  assert.equal(L.cycleSelection(0, -1, 6), 5)
  assert.equal(L.cycleSelection(5, 1, 6), 0)
  assert.equal(L.cycleSelection(0, 6, 6), 0)
  assert.equal(L.cycleSelection(0, -7, 6), 5)
  assert.equal(L.cycleSelection(0, 1, 0), 0)
})
check("committing to the current workspace goes nowhere", () => {
  assert.equal(L.commitTarget(true, [{ id: 1, focused: true }], 0), null)
  assert.equal(L.commitTarget(false, [{ id: 1 }, { id: 2 }], 1), null)
  assert.equal(L.commitTarget(true, [{ id: 1, focused: true }, { id: 2 }], 1).id, 2)
  assert.equal(L.commitTarget(true, [], 0), null)
  assert.equal(L.commitTarget(null, null, 0), null)
})
check("the hover wins only while it is over a card", () => {
  assert.equal(L.highlightIndex(2, -1), 2)
  assert.equal(L.highlightIndex(2, 4), 4)
})
check("the pointer must really move before it hovers", () => {
  assert.equal(L.pointerMoved({ x: 0, y: 0 }, 3, 3, 4), false)
  assert.equal(L.pointerMoved({ x: 0, y: 0 }, 5, 0, 4), true)
  assert.equal(L.pointerMoved(null, 5, 0, 4), false)
})

// ---------------------------------------------------------------------------
section("parseSettings")
check("an absent file means everything on", () => {
  const defaults = { gestureOpen: true, accentTint: true, numericOrder: true,
    captureStaggerMs: 8, previewWaitMs: 0 }
  assert.deepEqual(L.parseSettings(""), defaults)
  assert.deepEqual(L.parseSettings(null), defaults)
  assert.deepEqual(L.parseSettings(undefined), defaults)
  assert.deepEqual(L.parseSettings("{oops"), defaults)
  assert.deepEqual(L.parseSettings("null"), defaults)
  assert.deepEqual(L.parseSettings("[]"), defaults)
})
check("booleans are taken as they are", () => {
  assert.equal(L.parseSettings('{"gestureOpen": false}').gestureOpen, false)
  assert.equal(L.parseSettings('{"accentTint": false}').accentTint, false)
  assert.equal(L.parseSettings('{"numericOrder": false}').numericOrder, false)
  assert.equal(L.parseSettings('{"gestureOpen": "no"}').gestureOpen, true)
  assert.equal(L.parseSettings('{"gestureOpen": 0}').gestureOpen, true)
  assert.equal(L.parseSettings('{"gestureOpen": null}').gestureOpen, true)
})
check("the stagger is clamped to 0..500", () => {
  assert.equal(L.parseSettings('{"captureStaggerMs": 80}').captureStaggerMs, 80)
  assert.equal(L.parseSettings('{"captureStaggerMs": 0}').captureStaggerMs, 0)
  assert.equal(L.parseSettings('{"captureStaggerMs": -5}').captureStaggerMs, 0)
  assert.equal(L.parseSettings('{"captureStaggerMs": 5000}').captureStaggerMs, 500)
  assert.equal(L.parseSettings('{"captureStaggerMs": 44.6}').captureStaggerMs, 45)
  assert.equal(L.parseSettings('{"captureStaggerMs": "fast"}').captureStaggerMs, 8)
  assert.equal(L.parseSettings('{"captureStaggerMs": null}').captureStaggerMs, 8)
})
check("the preview wait is clamped to 0..1000", () => {
  assert.equal(L.parseSettings('{"previewWaitMs": 200}').previewWaitMs, 200)
  assert.equal(L.parseSettings('{"previewWaitMs": -5}').previewWaitMs, 0)
  assert.equal(L.parseSettings('{"previewWaitMs": 99999}').previewWaitMs, 1000)
  assert.equal(L.parseSettings('{"previewWaitMs": "soon"}').previewWaitMs, 0)
})
check("a non-finite stagger falls back to the default", () => {
  // JSON cannot hold NaN; 1e999 parses as Infinity, and the parser rejects
  // non-finite numbers by leaving the default. Assert the exact default: a
  // mere "is finite" check would also pass if Infinity were clamped to 500,
  // which is a different behaviour.
  assert.equal(L.parseSettings('{"captureStaggerMs": 1e999}').captureStaggerMs, 8)
  assert.equal(L.parseSettings('{"previewWaitMs": 1e999}').previewWaitMs, 0)
})

// ---------------------------------------------------------------------------
section("parseSwipe: the input stream")
check("gesture phases parse", () => {
  assert.equal(L.parseSwipe("begin up").phase, "begin")
  assert.equal(L.parseSwipe("begin up").dir, "up")
  assert.equal(L.parseSwipe("begin down").dir, "down")
  assert.equal(L.parseSwipe("update up -123.45").dy, -123.45)
  assert.equal(L.parseSwipe("update down 90.00").dy, 90)
  assert.equal(L.parseSwipe("end down").cancelled, false)
  assert.equal(L.parseSwipe("end down cancelled").cancelled, true)
  assert.equal(L.parseSwipe("end up cancelled").phase, "end")
})
check("key presses parse", () => {
  for (const name of ["next", "previous", "commit", "toggle", "close"]) {
    assert.equal(L.parseSwipe("key " + name).name, name)
    assert.equal(L.parseSwipe("key " + name).phase, "key")
  }
})
check("junk is rejected cleanly", () => {
  assert.equal(L.parseSwipe("key bogus"), null)
  assert.equal(L.parseSwipe("key"), null)
  assert.equal(L.parseSwipe("init"), null)
  assert.equal(L.parseSwipe(""), null)
  assert.equal(L.parseSwipe(null), null)
  assert.equal(L.parseSwipe("update up nan"), null)
  assert.equal(L.parseSwipe("update"), null)
  assert.equal(L.parseSwipe("garbage line here"), null)
})
check("an unknown direction is not accepted as a direction", () => {
  // The stream only ever carries up/down. A future or corrupted line must not
  // be silently read as an upward swipe (which would open the overview).
  const event = L.parseSwipe("begin sideways")
  assert.equal(event, null, "an unknown direction was accepted as a gesture")
})
check("a key line with extra words is still a key line", () => {
  assert.equal(L.parseSwipe("key next extra").name, "next")
})

// ---------------------------------------------------------------------------
section("clamp01")
check("clamps to 0..1", () => {
  assert.equal(L.clamp01(1.5), 1)
  assert.equal(L.clamp01(-0.2), 0)
  assert.equal(L.clamp01(0.25), 0.25)
  assert.equal(L.clamp01(0), 0)
  assert.equal(L.clamp01(1), 1)
})

// ---------------------------------------------------------------------------
section("fuzz: random inputs never throw and never produce NaN")
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261021)
function pick(arr) { return arr[Math.floor(rand() * arr.length)] }
function randInt(n) { return Math.floor(rand() * n) }
const CLASSES = ["foot", "konsole", "org.kde.konsole", "chromium", "chrome-github.com__-Default",
  "gimp", "soffice.bin", "", "org.gnome.terminal", "wezterm", "com.mitchellh.ghostty"]
const TITLES = ["me@host:~/code", "✳ Fix the build", "nvim notes.md", "", "foo — Konsole",
  "Inbox", "me@host:~/x$", "user@host", "a@b:c"]
check("every function survives random arguments", () => {
  for (let i = 0; i < 3000; ++i) {
    const cls = pick(CLASSES)
    const title = pick(TITLES)
    const app = L.appName(cls, index)
    const label = L.windowLabel(cls, title, app)
    assert.equal(typeof label, "string")
    assert.ok(!label.includes("undefined"), "label has undefined: " + label)
    assert.ok(!label.includes("NaN"), "label has NaN: " + label)
    const addr = L.normalizeAddress(pick(["0x1", "1", "0xZZ", "", null, "0xabcdef"]))
    assert.ok(addr === "" || /^0x[0-9a-f]+$/.test(addr))
    const fit = L.layoutFor(randInt(20), randInt(3000), randInt(2000), randInt(40), randInt(40), 16 / 9)
    assert.ok(Number.isFinite(fit.cardW) && fit.cardW >= 0, "bad layout " + JSON.stringify(fit))
    assert.ok(fit.cols >= 1)
    // A move either stays on the same card (a step that would leave the grid)
    // or lands on a card that exists. The count is drawn once and reused: the
    // old form drew a fresh random bound for the assertion, so it could pass
    // against a different count than the call was given — and carried a
    // literal `|| true` that made it a no-op.
    const count = randInt(20)
    const cardIndex = randInt(20)
    const sel = L.moveSelection(cardIndex, randInt(3) - 1, randInt(3) - 1, 1 + randInt(6), count)
    assert.ok(sel === cardIndex || (sel >= 0 && sel < count),
      "moveSelection left the grid: " + sel + " from " + cardIndex + " of " + count)
    const cycleCount = 1 + randInt(20)
    const cyc = L.cycleSelection(randInt(20), randInt(9) - 4, cycleCount)
    assert.ok(cyc >= 0 && cyc < cycleCount, "cycleSelection out of range: " + cyc + " of " + cycleCount)
    L.parseSettings(pick(["", "{}", "{oops", '{"captureStaggerMs":3}', "null", "[]", '{"previewWaitMs":9}']))
    L.parseSwipe(pick(["begin up", "end down cancelled", "key next", "junk", "update up -3.5", ""]))
  }
})
check("random states never produce NaN geometry", () => {
  for (let i = 0; i < 500; ++i) {
    const mon = { id: 0, x: randInt(200), y: randInt(200), width: 800 + randInt(2000),
      height: 600 + randInt(1000), scale: rand() < 0.5 ? 1 : 2,
      activeWorkspace: { id: 1 }, focused: true }
    const workspaces = []
    const clients = []
    for (let w = 1; w <= 1 + randInt(6); ++w) {
      workspaces.push({ id: w, name: String(w), monitorID: 0, windows: randInt(3) })
    }
    for (let c = 0; c < randInt(10); ++c) {
      clients.push({
        address: "0x" + (0x1000 + c).toString(16),
        class: pick(CLASSES), title: pick(TITLES),
        at: [randInt(2000), randInt(2000)], size: [randInt(900), randInt(900)],
        workspace: { id: 1 + randInt(6) },
        mapped: rand() < 0.9, hidden: rand() < 0.1, floating: rand() < 0.3,
      })
    }
    const list = L.buildWorkspaces({ monitors: [mon], workspaces, clients }, index, (a) => ({ a }))
    for (const ws of list) {
      for (const w of ws.windows) {
        assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y)
          && Number.isFinite(w.w) && Number.isFinite(w.h), "NaN geometry")
        assert.ok(w.label !== undefined && typeof w.label === "string")
      }
    }
    // The capture pump must give every window exactly one slot.
    const total = L.assignCaptureOrder(list)
    const slots = list.flatMap((c) => c.windows.map((w) => w.captureOrder)).sort((a, b) => a - b)
    assert.equal(total, slots.length)
    assert.deepEqual(slots, Array.from({ length: total }, (_, k) => k))
    // And the display order must be a permutation of the same objects.
    const disp = L.displayOrder(list, [2, 1], true)
    assert.equal(disp.length, list.length)
    assert.deepEqual(new Set(disp).size, disp.length, "display order lost or duplicated a card")
  }
})

// ---------------------------------------------------------------------------
section("QML source invariants (the QML is not unit-testable, so it is read)")
const qml = fs.readFileSync(path.join(__dirname, "..", "WorkspaceSwitcher.qml"), "utf8")
// The code, without the comments: a comment that mentions an identifier must
// not be mistaken for a use of it.
const qmlCode = qml.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/^\s*import .*$/gm, " ")
check("the preview counter is per window, not per card", () => {
  // The preview wait compares captureLanded (previews that delivered) with
  // captureTargets (windows that can deliver). Both must count the same
  // thing: windows. A per-card flag makes the counter stop at the number of
  // cards, so the wait can never end early once a workspace holds more than
  // one window.
  const handler = qml.match(/onHasContentChanged\s*:\s*\{[\s\S]*?\n\s{16}\}/)
  assert.ok(handler, "onHasContentChanged handler not found")
  assert.ok(/counted/.test(handler[0]), "the handler no longer guards against double counting")
  const scope = handler[0].match(/(\w+)\.counted/)
  assert.ok(scope, "no counted flag in the handler")
  assert.equal(scope[1], "win",
    "the counted flag is scoped to '" + scope[1] + "', not to the window delegate: "
    + "captureLanded then counts cards while captureTargets counts windows")
})
check("the QML and the logic agree on the exported function names", () => {
  const used = new Set()
  const re = /Logic\.([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(qmlCode))) used.add(m[1])
  const exported = Object.keys(L)
  for (const name of used) {
    assert.ok(exported.includes(name), "the QML calls Logic." + name + "(), which is not exported")
  }
})
check("every exported logic function is reachable from the QML or the tests", () => {
  const used = new Set()
  const re = /Logic\.([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(qmlCode))) used.add(m[1])
  const internal = ["capitalize", "appName", "windowLabel"] // used inside the logic file
  for (const name of Object.keys(L)) {
    if (used.has(name) || internal.includes(name)) continue
    failures.push({ name: "dead export: " + name, error: new Error("never used") })
  }
})
check("the QML declares no unused root properties", () => {
  const declared = []
  const re = /(?:readonly\s+)?property\s+\w+\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g
  let m
  while ((m = re.exec(qmlCode))) declared.push(m[1])
  // A declaration is not a use: strip the declaration lines before looking
  // for reads.
  const body = qmlCode.replace(/(?:readonly\s+)?property\s+\w+\s+[A-Za-z_][A-Za-z0-9_]*\s*:/g, " ")
  const used = new Set()
  const useRe = /(?:root\.|this\.)?([A-Za-z_][A-Za-z0-9_]*)\b/g
  while ((m = useRe.exec(body))) used.add(m[1])
  for (const name of declared) {
    if (used.has(name)) continue
    // Quickshell injects `shell` and `manifest` into a plugin's root object;
    // they are declared so the injection has a property to land on, and the
    // plugin itself never reads them.
    if (name === "shell" || name === "manifest") continue
    failures.push({ name: "unused property: " + name, error: new Error("declared but never read") })
  }
})
check("the QML does not call root.<id> for an id (ids are not properties)", () => {
  // The plugin's own comment warns about this: root.swipeIdle is undefined and
  // the call silently kills the rest of the handler.
  const ids = new Set()
  const idRe = /^\s*id:\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/gm
  let m
  while ((m = idRe.exec(qml))) ids.add(m[1])
  const rootRe = /root\.([A-Za-z_][A-Za-z0-9_]*)/g
  while ((m = rootRe.exec(qmlCode))) {
    assert.ok(!ids.has(m[1]), "root." + m[1] + " is an id, not a property")
  }
})
check("every global shortcut registers under the appId property", () => {
  // One place for the id, so the five shortcuts cannot drift apart.
  const shortcuts = qmlCode.match(/GlobalShortcut\s*\{[\s\S]*?\n\s{2}\}/g) || []
  assert.equal(shortcuts.length, 5, "number of global shortcuts")
  for (const s of shortcuts) {
    assert.ok(/appid:\s*root\.appId/.test(s), "a shortcut hardcodes the app id")
  }
  const declared = qmlCode.match(/readonly property string appId:\s*"([^"]+)"/)
  assert.ok(declared, "no appId property")
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  assert.equal(declared[1], manifest.id, "appId and the manifest id differ")
})

// ---------------------------------------------------------------------------
console.log("")
if (failures.length) {
  console.log("FAIL: " + failures.length + " of " + checks + " checks failed")
  for (const f of failures) {
    console.log("  * " + f.name)
    // The first three lines of the message carry the values that differ.
    const lines = String(f.error && f.error.message).split("\n")
    for (const line of lines.slice(0, 3)) console.log("      " + line)
  }
  process.exit(1)
}
console.log("ok - " + checks + " checks passed")
