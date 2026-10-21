-- Test for the Hyprland wiring (hypr/workspace-switcher.lua).
--
-- The wiring is the one part of the plugin that runs outside quickshell, and
-- it had no test at all. This stubs the `hl` API, loads the real file and
-- checks what it registers and what it writes to the stream.
--
-- Run with: luajit test/lua-test.lua
--
-- Hermetic: the wiring derives its stream from XDG_RUNTIME_DIR, and this test
-- truncates that stream and writes key lines to it, so it must never run
-- against the session's real runtime dir (/run/user/<uid>) — doing so would
-- drive the *live* plugin. The test pins the wiring's XDG_RUNTIME_DIR (and,
-- for the fallback cases, HOME and XDG_CACHE_HOME) to scratch directories of
-- its own for the duration of the load, whatever the caller's environment says.
local WIRING = (arg and arg[1]) or "hypr/workspace-switcher.lua"

local function make_scratch()
  local tmp = os.tmpname()
  os.remove(tmp)
  local dir = tmp .. ".d"
  os.execute("mkdir -p '" .. dir .. "'")
  return dir
end
local SCRATCH = make_scratch()

local real_getenv = os.getenv
local function pin_runtime()
  os.getenv = function(name)
    if name == "XDG_RUNTIME_DIR" then return SCRATCH end
    return real_getenv(name)
  end
end

local failures = {}
local checks = 0

local function check(name, fn)
  checks = checks + 1
  local ok, err = pcall(fn)
  if not ok then failures[#failures + 1] = { name = name, err = tostring(err) } end
end

local function eq(a, b, what)
  if a ~= b then
    error(string.format("%s: expected %s, got %s", what or "value",
      type(b) == "string" and string.format("%q", b) or tostring(b),
      type(a) == "string" and string.format("%q", a) or tostring(a)), 2)
  end
end

-- The stream the wiring writes to: the scratch dir, never the caller's.
local RUNTIME = SCRATCH
local STREAM = RUNTIME .. "/omarchy-workspace-switcher-swipe"

-- The stubbed Hyprland Lua API: everything the wiring touches.
local binds, unbinds, gestures, calls = {}, {}, {}, {}
_G.hl = {
  bind = function(chord, callback, options)
    binds[#binds + 1] = { chord = chord, callback = callback, options = options or {} }
    calls[#calls + 1] = "bind " .. chord
  end,
  unbind = function(chord)
    unbinds[#unbinds + 1] = chord
    calls[#calls + 1] = "unbind " .. chord
  end,
  gesture = function(spec)
    gestures[#gestures + 1] = spec
    calls[#calls + 1] = "gesture " .. tostring(spec.direction)
  end,
}

-- Load the wiring with a clean slate.
local function load_wiring(mod, horizontal)
  binds, unbinds, gestures, calls = {}, {}, {}, {}
  _G.__omarchy_workspace_switcher_wired = nil
  _G.OMARCHY_SWITCHER_MOD = mod
  _G.OMARCHY_SWITCHER_HORIZONTAL_SWIPE = horizontal
  pin_runtime()
  local ok, err = pcall(dofile, WIRING)
  os.getenv = real_getenv
  if not ok then error(err, 0) end
end

-- Load the wiring with an explicit environment, for the fallback-path tests.
local function load_wiring_env(runtime, home, cache)
  binds, unbinds, gestures, calls = {}, {}, {}, {}
  _G.__omarchy_workspace_switcher_wired = nil
  _G.OMARCHY_SWITCHER_MOD = nil
  _G.OMARCHY_SWITCHER_HORIZONTAL_SWIPE = nil
  local real = os.getenv
  os.getenv = function(name)
    if name == "XDG_RUNTIME_DIR" then return runtime end
    if name == "HOME" then return home end
    if name == "XDG_CACHE_HOME" then return cache end
    return real(name)
  end
  local ok, err = pcall(dofile, WIRING)
  os.getenv = real
  if not ok then error(err, 0) end
end

local function shell_quote(text)
  return "'" .. text:gsub("'", "'\\''") .. "'"
end

local function dir_mode(path)
  local pipe = io.popen("stat -c %a " .. shell_quote(path) .. " 2>/dev/null")
  if not pipe then return nil end
  local mode = pipe:read("*l")
  pipe:close()
  return mode
end

local function file_text(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local text = f:read("*a")
  f:close()
  return text
end

local function stream_lines()
  local f = io.open(STREAM, "r")
  if not f then return {} end
  local content = f:read("*a")
  f:close()
  local lines = {}
  for line in (content .. "\n"):gmatch("([^\n]*)\n") do
    if line ~= "" then lines[#lines + 1] = line end
  end
  return lines
end

local function clear_stream()
  local f = io.open(STREAM, "w")
  if f then f:close() end
end

-- ---------------------------------------------------------------------------
print("- the file is loaded and the stream is created")
clear_stream()
load_wiring(nil, nil)
check("the stream file exists after loading", function()
  local f = io.open(STREAM, "r")
  assert(f, "the stream file was not created")
  f:close()
end)
check("the stream starts with the init marker", function()
  local lines = stream_lines()
  eq(lines[1], "init", "first stream line")
end)

-- ---------------------------------------------------------------------------
print("- the binds it registers")
load_wiring(nil, nil)
check("Super + Tab cycles forward", function()
  local found = nil
  for _, b in ipairs(binds) do
    if b.chord == "SUPER + Tab" then found = b end
  end
  assert(found, "no SUPER + Tab bind")
  eq(found.options.description, "Switch workspace (hold SUPER, release to commit)", "description")
  assert(type(found.callback) == "function", "the bind has no function callback")
end)
check("Super + Shift + Tab cycles backwards", function()
  local found = nil
  for _, b in ipairs(binds) do
    if b.chord == "SUPER + SHIFT + Tab" then found = b end
  end
  assert(found, "no SUPER + SHIFT + Tab bind")
end)
check("the Super release commits, on both Super keys", function()
  local releases = {}
  for _, b in ipairs(binds) do
    if b.options.release then releases[#releases + 1] = b end
  end
  eq(#releases, 2, "number of release binds")
  local chords = {}
  for _, b in ipairs(releases) do chords[b.chord] = true end
  assert(chords["SUPER + Super_L"], "no SUPER + Super_L release bind")
  assert(chords["SUPER + Super_R"], "no SUPER + Super_R release bind")
  for _, b in ipairs(releases) do
    eq(b.options.transparent, true, "transparent")
    eq(b.options.non_consuming, true, "non_consuming")
    eq(b.options.ignore_mods, true, "ignore_mods")
  end
end)
check("the chords it takes over are unbound first", function()
  eq(#unbinds, 2, "number of unbinds")
  eq(unbinds[1], "SUPER + TAB", "first unbind")
  eq(unbinds[2], "SUPER + SHIFT + TAB", "second unbind")
  eq(#binds, 4, "number of binds")
  -- The unbind has to come before the bind of the same chord: Hyprland runs
  -- every bind registered for a chord, and an unbind after the bind would
  -- remove the wiring's own bind and leave the stock one in place.
  local order = {}
  for i, call in ipairs(calls) do order[call] = i end
  assert(order["unbind SUPER + TAB"] < order["bind SUPER + Tab"],
    "SUPER + TAB is bound before it is unbound")
  assert(order["unbind SUPER + SHIFT + TAB"] < order["bind SUPER + SHIFT + Tab"],
    "SUPER + SHIFT + TAB is bound before it is unbound")
end)
check("no chord carries two binds", function()
  local seen = {}
  for _, b in ipairs(binds) do
    assert(not seen[b.chord], "duplicate chord: " .. b.chord)
    seen[b.chord] = true
  end
end)
-- ---------------------------------------------------------------------------
print("- the fallback directory")
local FALLBACK_HOME = make_scratch()
local OLD_TMP = "/tmp/omarchy-workspace-switcher-swipe"
local old_tmp_text = file_text(OLD_TMP)

check("an empty XDG_RUNTIME_DIR uses a 0700 cache directory, not /tmp", function()
  load_wiring_env("", FALLBACK_HOME, nil)
  local dir = FALLBACK_HOME .. "/.cache/omarchy-workspace-switcher"
  eq(dir_mode(dir), "700", "fallback directory mode")
  local content = file_text(dir .. "/omarchy-workspace-switcher-swipe")
  assert(content, "the fallback stream file was not written")
  assert(content:find("init", 1, true), "the init marker is missing from the fallback stream")
  -- The old bare /tmp path must not be touched, and nothing goes to the root.
  eq(file_text(OLD_TMP), old_tmp_text, "the old /tmp stream path was written")
  assert(not file_text("/omarchy-workspace-switcher-swipe"),
    "the wiring wrote to the filesystem root")
end)
check("XDG_CACHE_HOME wins over HOME for the fallback", function()
  local cache = FALLBACK_HOME .. "/xdg-cache"
  load_wiring_env("", FALLBACK_HOME, cache)
  local dir = cache .. "/omarchy-workspace-switcher"
  eq(dir_mode(dir), "700", "cache directory mode")
  local content = file_text(dir .. "/omarchy-workspace-switcher-swipe")
  assert(content and content:find("init", 1, true), "no init marker in the cache stream")
end)

-- ---------------------------------------------------------------------------
print("- the gestures it registers")
load_wiring(nil, nil)
check("three-finger up and down, both exempt from the inhibitor", function()
  eq(#gestures, 2, "number of gestures")
  local up, down = gestures[1], gestures[2]
  eq(up.fingers, 3, "fingers (up)")
  eq(up.direction, "up", "direction (up)")
  eq(up.disable_inhibit, true, "disable_inhibit (up)")
  eq(down.fingers, 3, "fingers (down)")
  eq(down.direction, "down", "direction (down)")
  eq(down.disable_inhibit, true, "disable_inhibit (down)")
end)
check("the horizontal swipe is not registered by default", function()
  eq(#gestures, 2, "number of gestures")
end)
check("the horizontal swipe is registered on request", function()
  load_wiring(nil, true)
  eq(#gestures, 3, "number of gestures")
  eq(gestures[1].direction, "horizontal", "the horizontal gesture")
  eq(gestures[1].action, "workspace", "the horizontal gesture's action")
end)

-- ---------------------------------------------------------------------------
print("- the modifier knob")
check("ALT moves the keys and the unbind to Alt", function()
  load_wiring("ALT", nil)
  local chords = {}
  for _, b in ipairs(binds) do chords[b.chord] = true end
  assert(chords["ALT + Tab"], "no ALT + Tab bind")
  assert(chords["ALT + Super_L"] == nil, "a Super release bind in the ALT arrangement")
  eq(unbinds[1], "ALT + TAB", "the unbound chord")
end)
check("a lowercase modifier is normalised", function()
  load_wiring("alt", nil)
  local chords = {}
  for _, b in ipairs(binds) do chords[b.chord] = true end
  assert(chords["ALT + Tab"], "a lowercase 'alt' did not normalise")
  eq(unbinds[1], "ALT + TAB", "the unbound chord")
end)
check("an unknown modifier falls back to SUPER", function()
  load_wiring("FOO", nil)
  local chords = {}
  for _, b in ipairs(binds) do chords[b.chord] = true end
  assert(chords["SUPER + Tab"], "an unknown modifier did not fall back to SUPER")
  eq(unbinds[1], "SUPER + TAB", "the unbound chord")
end)
check("a non-string modifier falls back to SUPER", function()
  load_wiring(123, nil)
  local chords = {}
  for _, b in ipairs(binds) do chords[b.chord] = true end
  assert(chords["SUPER + Tab"], "a numeric modifier did not fall back to SUPER")
end)
check("the wiring only loads once", function()
  load_wiring(nil, nil)
  local before = #binds
  dofile(WIRING)
  eq(#binds, before, "the second load registered more binds")
end)

-- ---------------------------------------------------------------------------
print("- what it writes to the stream")
load_wiring(nil, nil)
clear_stream()
check("a key press writes a key line", function()
  for _, b in ipairs(binds) do
    if b.chord == "SUPER + Tab" then b.callback() end
  end
  local lines = stream_lines()
  eq(lines[#lines], "key next", "the last line")
end)
check("repeated identical key presses each land", function()
  clear_stream()
  local tab
  for _, b in ipairs(binds) do
    if b.chord == "SUPER + Tab" then tab = b end
  end
  tab.callback()
  tab.callback()
  tab.callback()
  local lines = stream_lines()
  eq(#lines, 3, "number of lines")
  eq(lines[1], "key next", "first line")
  eq(lines[3], "key next", "third line")
end)
check("a gesture writes begin/update/end", function()
  clear_stream()
  local action = gestures[1].action
  action.start({})
  action.update({ delta = { y = -12 } })
  action.update({ delta = { y = -12 } })
  action.finish({})
  local lines = stream_lines()
  eq(lines[1], "begin up", "the begin line")
  eq(lines[2], "update up -12.00", "the first update line")
  eq(lines[3], "update up -24.00", "the second update line (the travel accumulates)")
  eq(lines[4], "end up", "the end line")
end)
check("an unchanged update is written only once", function()
  clear_stream()
  local action = gestures[1].action
  action.start({})
  action.update({ delta = { y = -5 } })
  action.update({ delta = { y = 0 } })
  action.finish({})
  local lines = stream_lines()
  eq(#lines, 3, "number of lines")
  eq(lines[2], "update up -5.00", "the update line")
end)
check("a cancelled gesture is marked", function()
  clear_stream()
  local action = gestures[1].action
  action.start({})
  action.update({ delta = { y = -30 } })
  action.finish({ cancelled = true })
  local lines = stream_lines()
  eq(lines[#lines], "end up cancelled", "the end line")
end)
check("a downward gesture accumulates downwards", function()
  clear_stream()
  local action = gestures[2].action
  action.start({})
  action.update({ delta = { y = 40 } })
  action.finish({})
  local lines = stream_lines()
  eq(lines[1], "begin down", "the begin line")
  eq(lines[2], "update down 40.00", "the update line")
  eq(lines[3], "end down", "the end line")
end)
check("the stream is appended to, never rewritten", function()
  clear_stream()
  local action = gestures[1].action
  action.start({})
  action.update({ delta = { y = -1 } })
  local f = io.open(STREAM, "r")
  local content = f:read("*a")
  f:close()
  assert(#content > 0, "the stream is empty")
  -- A rewrite would leave one line; an append leaves both.
  local n = select(2, content:gsub("\n", ""))
  eq(n, 2, "number of lines in the stream")
end)
check("the stream stays bounded when nothing drains it", function()
  clear_stream()
  local action = gestures[1].action
  for i = 1, 6000 do
    action.start({})
    action.update({ delta = { y = -1 } })
    -- A changing travel value defeats the dedupe, so every line is new.
    action.update({ delta = { y = -0.01 * i } })
  end
  local f = io.open(STREAM, "r")
  local content = f:read("*a")
  f:close()
  local size = #content
  assert(size <= 65536 + 256, "the stream grew to " .. size .. " bytes, the cap did not hold")
  -- The last line must still be a complete line: the cap truncates between
  -- lines, never inside one.
  assert(content:sub(-1) == "\n", "the stream ends mid-line")
  local lines = select(2, content:gsub("\n", ""))
  assert(lines > 0, "the stream is empty")
end)

-- ---------------------------------------------------------------------------
os.execute("rm -rf " .. shell_quote(SCRATCH) .. " " .. shell_quote(FALLBACK_HOME))
print("")
if #failures > 0 then
  print(string.format("FAIL: %d of %d checks failed", #failures, checks))
  for _, f in ipairs(failures) do
    print("  * " .. f.name)
    print("      " .. f.err)
  end
  os.exit(1)
end
print(string.format("ok - %d checks passed", checks))
