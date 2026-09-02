-- Reads Hyprland gesture config by running it against recording stubs and
-- reporting what it set. Lua reading Lua, so there is no second grammar to keep
-- in sync with Hyprland's.
--
--   lua read.lua <path>        run a file
--   lua read.lua -e <source>   run a string (one segment of input.lua)
--
-- Output is one tab-separated record per line:
--
--   g  <fingers>  <direction>  <action>  <mode>  <mods>  <workspace>  <custom>
--      <scale>  <zoom_level>  <disable_inhibit>
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
      spec.disable_inhibit == true and "true" or "")
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

-- Undefined globals in a personal config must not abort the read.
setmetatable(_G, { __index = function() return inert() end })

local source, name
if arg[1] == "-e" then
  source, name = arg[2] or "", "luddite-gestures-segment"
else
  local file, err = io.open(arg[1], "r")
  if not file then
    io.stderr:write(tostring(err))
    os.exit(1)
  end
  source, name = file:read("a"), arg[1]
  file:close()
end

local chunk, loadErr = load(source, name, "t")
if not chunk then
  io.stderr:write(tostring(loadErr))
  os.exit(1)
end

local ok, runErr = pcall(chunk)
if not ok then
  io.stderr:write(tostring(runErr))
  os.exit(1)
end

print(table.concat(out, "\n"))
