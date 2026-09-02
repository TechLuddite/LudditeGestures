-- Reads Hyprland gesture config by running it against recording stubs and
-- reporting what it set. Lua reading Lua, so there is no second grammar to keep
-- in sync with Hyprland's.
--
--   lua read.lua <path>        run a file
--   lua read.lua -e <source>   run a string (one segment of input.lua)
--   lua read.lua --check -e <source>
--                              only check that it compiles, and run nothing
--
-- --check is what the panel calls before it writes. A dispatcher gesture carries
-- argument text the user typed, and that text lands in the file as Lua: one typo
-- would be a syntax error in the whole of input.lua, taking the rest of the
-- config down with it and leaving the panel unable to show the gesture to fix.
-- Better to refuse the save.
--
-- Output is one tab-separated record per line:
--
--   g  <fingers>  <direction>  <action>  <mode>  <mods>  <workspace>  <custom>
--      <scale>  <zoom_level>  <disable_inhibit>
--      <double>  <within_ms>  <min_distance>  <hint>  <args>
--   c  <key>  <type>  <value>
--
-- The three trailing gesture fields were added after the first release, so they
-- are appended rather than woven in: an older reader still finds what it knows
-- at the index it expects.
--
-- Nothing is applied: every stub only records. A hand-written gesture whose
-- action is a Lua function or a table of callbacks is reported with action
-- "custom" and custom=true, so the panel can show it without pretending it
-- could round-trip it through a dropdown.
--
-- Chunks load in text mode only ("t"), never as precompiled bytecode.

local out = {}

local function clean(s)
  return (tostring(s):gsub("\t", " "):gsub("\n", " "))
end

local function emit(...)
  local parts = {}
  for i, v in ipairs({ ... }) do parts[i] = clean(v) end
  out[#out + 1] = table.concat(parts, "\t")
end

-- Personal config reaches for helpers this harness has no reason to implement
-- (hl.dsp.window.close(), o.notify(...), and anything a future Omarchy adds).
-- Rather than guess at the surface, anything not recorded answers to being
-- indexed and to being called, and does nothing.
local function inert()
  local t = {}
  return setmetatable(t, {
    __index = function() return inert() end,
    __call = function() return inert() end,
    __tostring = function() return "" end,
    __concat = function() return "" end,
  })
end

local function gestureAction(action)
  local kind = type(action)
  if kind == "string" then return action, false end
  -- A function, or a { start =, update =, finish = } table: real, active, and
  -- not expressible as a built-in action.
  if kind == "function" or kind == "table" then return "custom", true end
  return "", false
end

local recorded = {
  gesture = function(spec)
    if type(spec) ~= "table" then return end
    local action, custom = gestureAction(spec.action)
    emit("g",
      tonumber(spec.fingers) or 0,
      spec.direction or "",
      action,
      spec.mode or "",
      spec.mods or "",
      spec.workspace_name or "",
      custom,
      -- Reported so the panel can put them back. `scale` and `zoom_level` it
      -- also edits; `disable_inhibit` it does not, and carrying it through
      -- untouched is the only way a hand-written one survives a save.
      spec.scale or "",
      spec.zoom_level or "",
      spec.disable_inhibit == true and "true" or "",
      "", "", "", "", "")
  end,

  -- Only the gestures:* subtree is the panel's business.
  config = function(t)
    if type(t) ~= "table" or type(t.gestures) ~= "table" then return end
    for k, v in pairs(t.gestures) do
      if type(v) ~= "table" then emit("c", k, type(v), v) end
    end
  end,
}

hl = setmetatable(recorded, { __index = function() return inert() end })
o = inert()

-- A double swipe has to be timed in Lua, so the panel writes a helper into its
-- block and calls it once per guarded gesture. The block opens with
-- `local luddite = luddite`, which finds this recorder and skips the real
-- definition -- so those calls report themselves as data here, and come back
-- into the dropdowns as gestures rather than as an opaque callback.
--
-- This has to be a real global: the _G fallback below hands out inert tables for
-- undefined names, and an inert table would silently record nothing.
local function recordRun(spec, forceDouble)
  if type(spec) ~= "table" then return end
  local double = forceDouble or spec.double == true
  emit("g",
    tonumber(spec.fingers) or 0,
    spec.direction or "",
    spec.action or "",
    "", spec.mods or "", "",
    false,            -- editable, not a callback the panel has to shy away from
    "", "", "",
    double and "true" or "",
    tonumber(spec.within_ms) or 0,
    tonumber(spec.min_distance) or 0,
    spec.hint or "",
    spec.args or "")
end

luddite = {
  run = recordRun,
  -- What the helper was called before it also handled dispatchers. A block
  -- written by the older panel and not yet re-saved still has to read.
  double = function(spec) return recordRun(spec, true) end,
}

-- Undefined globals in a personal config must not abort the read.
setmetatable(_G, { __index = function() return inert() end })

local args, checkOnly = arg, false
if args[1] == "--check" then
  checkOnly = true
  args = { args[2], args[3] }
end

local source, name
if args[1] == "-e" then
  source, name = args[2] or "", "luddite-gestures-segment"
else
  local file, err = io.open(args[1], "r")
  if not file then
    io.stderr:write(tostring(err))
    os.exit(1)
  end
  source, name = file:read("a"), args[1]
  file:close()
end

local chunk, loadErr = load(source, name, "t")
if not chunk then
  io.stderr:write(tostring(loadErr))
  os.exit(1)
end

-- It compiles. That is the whole of --check: nothing is run, and nothing is
-- printed, so the caller reads the exit status alone.
if checkOnly then os.exit(0) end

local ok, runErr = pcall(chunk)
if not ok then
  io.stderr:write(tostring(runErr))
  os.exit(1)
end

print(table.concat(out, "\n"))
