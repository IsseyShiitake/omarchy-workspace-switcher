// Run with: node test/logic-test.js
const assert = require("node:assert/strict")
const L = require("../WorkspaceSwitcherLogic.js")

// Visits: most recent first, no duplicates, ignores invalid ids.
let recent = []
for (const id of [1, 3, 5, 3, 2]) recent = L.touchRecent(recent, id)
assert.deepEqual(recent, [2, 3, 5, 1])
assert.deepEqual(L.touchRecent(recent, -1), recent)

// Cards in order of visit, focused first, unvisited by number at the end.
const ws = [1, 2, 3, 5, 7, 8].map((id) => ({ id, focused: id === 3 }))
assert.deepEqual(L.sortByRecent(ws, recent).map((w) => w.id), [3, 2, 5, 1, 7, 8])

// Alt + Tab: first Tab selects the previous workspace, Shift + Tab the least
// recent; letting go on the current workspace goes nowhere.
assert.equal(L.cycleSelection(0, 1, 6), 1)
assert.equal(L.cycleSelection(0, -1, 6), 5)
assert.equal(L.commitTarget(true, [{ id: 1, focused: true }], 0), null)
assert.equal(L.commitTarget(false, [{ id: 1 }, { id: 2 }], 1), null)
assert.equal(L.commitTarget(true, [{ id: 1, focused: true }, { id: 2 }], 1).id, 2)

// Hover wins only while over a card.
assert.equal(L.highlightIndex(2, -1), 2)
assert.equal(L.highlightIndex(2, 4), 4)
assert.equal(L.pointerMoved({ x: 0, y: 0 }, 3, 3, 4), false)
assert.equal(L.pointerMoved({ x: 0, y: 0 }, 5, 0, 4), true)

// Terminal labels.
assert.equal(L.windowLabel("foot", "✳ Fix the build", "Foot"), "✳ Fix the build")
assert.equal(L.windowLabel("foot", "me@host:~/code", "Foot"), "~/code")
assert.equal(L.windowLabel("foot", "", "Foot"), "Foot")
assert.equal(L.windowLabel("chromium", "Inbox", "Chromium"), "Chromium")

// App names: reverse-DNS ids answer to their basename, and the ".desktop"
// suffix is never indexed (it would collide as a junk "desktop" key).
const idx = L.appNameIndex([
  { name: "GNU Image Manipulation Program", id: "org.gimp.GIMP" },
  { name: "Firefox Web Browser", id: "firefox.desktop" },
])
assert.equal(idx["desktop"], undefined)
assert.equal(L.appName("gimp", idx), "GNU Image Manipulation Program")
assert.equal(L.appName("firefox", idx), "Firefox Web Browser")
assert.equal(L.appName("soffice.bin", {}), "LibreOffice")

// Bindings: Alt + Tab cycles (Super + Tab is never touched, so the
// machine's window cycling survives), the release options, and a restore
// that only acts for the instance that bound them.
const bind = L.bindingScript("app.id", "owner1")
assert.match(bind, /hl\.bind\("ALT \+ TAB", hl\.dsp\.global\("app\.id:next"\)/)
assert.match(bind, /hl\.bind\("ALT \+ SHIFT \+ TAB", hl\.dsp\.global\("app\.id:previous"\)/)
assert.match(bind, /"Alt_L", "Alt_R/)
assert.match(bind, /release = true, transparent = true, non_consuming = true, ignore_mods = true/)
assert.doesNotMatch(bind, /SUPER/)
const restore = L.restoreScript("owner1")
assert.match(restore, /^if _G\.workspaceSwitcherBindingOwner == "owner1" then .* end$/)
assert.match(restore, /hl\.unbind\("ALT \+ TAB"\)/)
assert.doesNotMatch(restore, /SUPER/)
assert.doesNotMatch(restore, /hl\.bind\(/)

// Terminal label details: prompt sigils are decoration, and terminals that
// append their own name ("… — Konsole") lose it before parsing.
assert.equal(L.windowLabel("foot", "me@host:~/code$", "Foot"), "~/code")
assert.equal(L.windowLabel("foot", "me@host:~/code#", "Foot"), "~/code")
assert.equal(L.windowLabel("konsole", "me@host:~/code — Konsole", "Konsole"), "~/code")
assert.equal(L.windowLabel("konsole", "nvim notes.md — Konsole", "Konsole"), "nvim notes.md")

// Malformed geometry never poisons the layout: the client is skipped.
const noGeom = L.buildWorkspaces({
  monitors: [{ id: 0, x: 0, y: 0, width: 1920, height: 1080, scale: 1,
    activeWorkspace: { id: 1 }, focused: true }],
  workspaces: [{ id: 1, name: "1", monitorID: 0, windows: 1 }],
  clients: [{ address: "0x1", class: "foot", title: "t", workspace: { id: 1 } }],
}, {}, null)
assert.equal(noGeom[0].windows.length, 0)

console.log("ok")
