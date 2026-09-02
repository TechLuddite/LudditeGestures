.pragma library

// Renders and reads the managed block in ~/.config/hypr/input.lua.
//
// Only what sits between the fences is ever rewritten. Everything else in the
// file -- including hand-written hl.gesture calls with Lua callbacks, which no
// GUI can represent -- is read for context and left exactly as it was.
//
// The same renderer feeds the file and the conflict check, so what you are
// warned about is what gets written.

var BEGIN_FENCE = "-- >>> luddite-gestures managed block >>>"
var END_FENCE = "-- <<< luddite-gestures managed block <<<"

var HEADER =
    "-- Written by Luddite Gestures. Safe to hand-edit: the panel re-reads this\n"
  + "-- block every time it opens, and only ever rewrites what is between the\n"
  + "-- fences. Gestures you write outside them are shown but never touched.\n"

// ---------------------------------------------------------------- rendering

function luaString(value) {
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

function luaNumber(n) {
  var v = Number(n)
  if (!isFinite(v)) return "0"
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return String(parseFloat(v.toFixed(4)))
}

function luaValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return luaNumber(value)
  return luaString(value)
}

// Optional fields are omitted when empty rather than written as "", so the
// block stays as short as the equivalent hand-written line.
//
// `scale` goes out as a bare Lua number because the parser types it as a float
// and rejects a string; `zoom_level` goes out quoted because the parser types
// it as a string and rejects a table. `disable_inhibit` the panel never edits
// -- it is carried from the read so a hand-written one is not lost on save.
function renderGesture(g) {
  var parts = [
    "fingers = " + luaNumber(g.fingers),
    "direction = " + luaString(g.direction),
    "action = " + luaString(g.action)
  ]
  if (g.mode) parts.push("mode = " + luaString(g.mode))
  if (g.mods) parts.push("mods = " + luaString(g.mods))
  if (g.workspace_name) parts.push("workspace_name = " + luaString(g.workspace_name))
  if (g.scale) parts.push("scale = " + luaNumber(g.scale))
  if (g.zoom_level) parts.push("zoom_level = " + luaString(g.zoom_level))
  if (g.disable_inhibit) parts.push("disable_inhibit = true")
  return "hl.gesture({ " + parts.join(", ") + " })"
}

// ------------------------------------------------ gestures the panel writes Lua for
//
// Two kinds of gesture are not a plain hl.gesture call:
//
//   * a dispatcher gesture, which runs the same call a keybind would, and
//   * a guarded one, which only fires on the second swipe.
//
// Both are Lua callbacks, so the panel writes the callback rather than leaving
// you to hand-write one it would then refuse to manage. One helper covers both.
//
// The trick that keeps it readable BOTH ways is the first line. Under Hyprland
// the global `luddite` is nil, so the helper defines itself and registers real
// gestures. Under read.lua the global is a recorder, so the definition is
// skipped and every luddite.run(...) call reports its arguments as data -- which
// is how these come back into the dropdowns instead of reading as an opaque
// callback. Lua reading Lua, same as the rest.
var RUN_HELPER = [
  "-- Dispatcher gestures and \"twice, quickly\" guards are Lua callbacks, which",
  "-- Hyprland has no gesture action for. This is what Luddite Gestures writes so",
  "-- both stay editable in the panel; reading the block back skips this.",
  "local luddite = luddite",
  "if not luddite then",
  "  luddite = {}",
  "  function luddite.run(s)",
  "    local last, travelled = nil, 0",
  "    hl.gesture({",
  "      fingers = s.fingers,",
  "      direction = s.direction,",
  "      mods = s.mods,",
  "      action = {",
  "        start = function() travelled = 0 end,",
  "        update = function(e)",
  "          if e.delta then",
  "            local dx, dy = e.delta.x or 0, e.delta.y or 0",
  "            travelled = travelled + math.sqrt(dx * dx + dy * dy)",
  "          end",
  "        end,",
  "        finish = function(e)",
  "          if e.cancelled or travelled < (s.min_distance or 0) then return end",
  "          if not s.double then",
  "            hl.dispatch(s.run())",
  "            return",
  "          end",
  "          local now = e.time_ms or 0",
  "          if last and (now - last) <= (s.within_ms or 700) then",
  "            last = nil",
  "            hl.dispatch(s.run())",
  "          else",
  "            last = now",
  "            if s.hint and s.hint ~= \"\" then",
  "              hl.dispatch(hl.dsp.exec_cmd(o.notify(s.hint)))",
  "            end",
  "          end",
  "        end,",
  "      },",
  "    })",
  "  end",
  "end"
].join("\n")

// A gesture Hyprland's own parser cannot express, so the panel writes Lua.
function needsHelper(g, schema) {
  return !!(g && (g.double || schema.isDispatchAction(g.action)))
}

// The call the gesture makes. A dispatcher action drops the user's own argument
// text between the parentheses, exactly as a keybind would write it; the two
// guardable built-ins map to the dispatcher that matches them.
function dispatchCall(g, schema) {
  if (schema.isDispatchAction(g.action))
    return "hl.dsp." + schema.dispatcherOf(g.action) + "(" + String(g.dispatch_args || "") + ")"
  if (g.action === "float") return "hl.dsp.window.float()"
  return "hl.dsp.window.close()"
}

// `run` is what Hyprland calls; `action` and `args` beside it are what the panel
// reads back. The renderer always writes all three from the same two fields, so
// they cannot drift -- and the block is rewritten whole on every save.
function renderHelperGesture(g, schema) {
  var parts = [
    "fingers = " + luaNumber(g.fingers),
    "direction = " + luaString(g.direction),
    "action = " + luaString(g.action)
  ]
  if (g.mods) parts.push("mods = " + luaString(g.mods))
  if (schema.isDispatchAction(g.action) && g.dispatch_args)
    parts.push("args = " + luaString(g.dispatch_args))
  if (g.double) {
    parts.push("double = true")
    parts.push("within_ms = " + luaNumber(g.double_within_ms))
    parts.push("min_distance = " + luaNumber(g.double_min_distance))
    if (g.double_hint) parts.push("hint = " + luaString(g.double_hint))
  }
  parts.push("run = function() return " + dispatchCall(g, schema) + " end")
  return "luddite.run({ " + parts.join(", ") + " })"
}

// The argument text goes into the file as Lua, so a typo there is a syntax error
// in the whole of input.lua -- which would take the rest of the config down with
// it and leave the panel unable to show you the gesture to fix. read.lua --check
// is the real gate, run before anything is written; this is the cheap version,
// so the Save button can grey out while you are still typing.
function badLuaArgs(args) {
  var text = String(args || "")
  if (text === "") return ""
  if (/[\r\n]/.test(text)) return "must be a single line"
  if (text.indexOf("--") !== -1) return "cannot contain a Lua comment"

  var pairs = { ")": "(", "]": "[", "}": "{" }
  var stack = []
  var quote = ""
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i)
    if (quote) {
      if (c === "\\") { i++; continue }
      if (c === quote) quote = ""
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === "(" || c === "[" || c === "{") { stack.push(c); continue }
    if (pairs.hasOwnProperty(c)) {
      if (stack.pop() !== pairs[c]) return "has a bracket that does not match"
    }
  }
  if (quote) return "has an unclosed quote"
  if (stack.length > 0) return "has an unclosed bracket"
  return ""
}

// Only tunables that differ from the Hyprland default are written, so the block
// does not pin values the user never chose.
function renderTunables(tunables, schema) {
  var keys = Object.keys(tunables || {}).sort()
  var lines = []
  for (var i = 0; i < keys.length; i++) {
    var spec = schema.tunableFor(keys[i])
    if (!spec) continue
    var value = tunables[keys[i]]
    if (value === undefined || value === null) continue
    if (String(value) === String(spec.def)) continue
    // A "percent" tunable is edited as a whole number and stored as a fraction.
    var written = spec.scale ? Number(value) / spec.scale : value
    lines.push("    " + keys[i] + " = " + luaValue(written) + ",")
  }
  if (lines.length === 0) return ""
  return "hl.config({\n  gestures = {\n" + lines.join("\n") + "\n  },\n})"
}

// Gestures keep their file order whichever kind they are, because that order is
// what decides which one Hyprland registers first. The helper is only written
// when something actually uses it.
function renderBody(gestures, tunables, schema) {
  var chunks = []
  var config = renderTunables(tunables, schema)
  if (config) chunks.push(config)

  var list = gestures || []
  var wantsHelper = false
  for (var i = 0; i < list.length; i++) if (needsHelper(list[i], schema)) { wantsHelper = true; break }
  if (wantsHelper) chunks.push(RUN_HELPER)

  var lines = []
  for (var k = 0; k < list.length; k++)
    lines.push(needsHelper(list[k], schema)
      ? renderHelperGesture(list[k], schema)
      : renderGesture(list[k]))
  if (lines.length > 0) chunks.push(lines.join("\n"))
  return chunks.join("\n\n")
}

function renderBlock(body) {
  if (!body) return BEGIN_FENCE + "\n" + HEADER + END_FENCE
  return BEGIN_FENCE + "\n" + HEADER + body + "\n" + END_FENCE
}

// ------------------------------------------------------------------ splicing

function splitBlock(text) {
  var source = String(text || "")
  var begin = source.indexOf(BEGIN_FENCE)
  if (begin === -1) return { found: false, before: source, body: "", after: "" }
  var end = source.indexOf(END_FENCE, begin)
  if (end === -1) return { found: false, before: source, body: "", after: "" }
  return {
    found: true,
    before: source.substring(0, begin),
    body: source.substring(begin + BEGIN_FENCE.length, end),
    after: source.substring(end + END_FENCE.length)
  }
}

// An empty body removes the block rather than leaving an empty husk behind.
function applyBlock(text, body) {
  var split = splitBlock(text)

  if (!body) {
    if (!split.found) return String(text || "")
    var joined = split.before.replace(/\n+$/, "\n") + split.after.replace(/^\n+/, "")
    return joined.replace(/\n{3,}$/, "\n")
  }

  var block = renderBlock(body)
  if (split.found) return split.before + block + split.after

  var head = String(text || "")
  if (head.length > 0 && head.charAt(head.length - 1) !== "\n") head += "\n"
  return head + "\n" + block + "\n"
}

// ------------------------------------------------------------------- parsing

// read.lua runs a chunk against recording stubs and prints one tab-separated
// record per line. Turning that into state is a split, not a parser.
//
//   g  <fingers>  <direction>  <action>  <mode>  <mods>  <workspace_name>  <custom>
//      <scale>  <zoom_level>  <disable_inhibit>
//      <double>  <within_ms>  <min_distance>  <hint>  <args>
//   c  <key>  <type>  <value>
//
// The last three arrived after the first release and are read defensively, so
// output from an older read.lua still parses into a usable gesture.
function parseHarness(stdout) {
  var result = { gestures: [], tunables: {} }
  var lines = String(stdout || "").split("\n")

  for (var i = 0; i < lines.length; i++) {
    var f = lines[i].split("\t")
    if (f[0] === "g" && f.length >= 8) {
      result.gestures.push({
        fingers: Number(f[1]) || 0,
        direction: f[2],
        action: f[3],
        mode: f[4],
        mods: f[5],
        workspace_name: f[6],
        custom: f[7] === "true",
        scale: f[8] ? Number(f[8]) || 0 : 0,
        zoom_level: f[9] || "",
        disable_inhibit: f[10] === "true",
        double: f[11] === "true",
        double_within_ms: f[12] ? Number(f[12]) || 0 : 0,
        double_min_distance: f[13] ? Number(f[13]) || 0 : 0,
        double_hint: f[14] || "",
        dispatch_args: f[15] || ""
      })
    } else if (f[0] === "c" && f.length >= 4) {
      result.tunables[f[1]] = f[2] === "number" ? Number(f[3])
        : f[2] === "boolean" ? f[3] === "true"
        : f[3]
    }
  }
  return result
}

// ----------------------------------------------------------------- conflicts

// A config written by hand may spell a direction "l" or "ZOOMIN"; the coverage
// table is keyed by the long lowercase form, so canonicalise before looking up
// or a hand-written gesture silently stops conflicting with anything.
function coverageOf(direction, schema) {
  var c = schema.COVERAGE[schema.canonicalDirection(direction)]
  return c ? c : []
}

function intersects(a, b) {
  for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) !== -1) return true
  return false
}

function covers(outer, inner) {
  for (var i = 0; i < inner.length; i++) if (outer.indexOf(inner[i]) === -1) return false
  return true
}

// Hyprland registers gestures in file order and refuses a new one whose reach an
// earlier gesture already covers entirely -- that is a hard error, and the save
// would fail. A partial overlap is accepted but means the earlier gesture quietly
// wins for the shared directions, which is worth saying out loud.
//
// `ordered` is every gesture in the file, in the order Hyprland sees them, each
// tagged with its origin so a warning can point at the right place.
function findConflicts(ordered, schema) {
  var issues = []
  for (var later = 0; later < ordered.length; later++) {
    var b = ordered[later]
    for (var earlier = 0; earlier < later; earlier++) {
      var a = ordered[earlier]
      if (a.fingers !== b.fingers) continue

      var ca = coverageOf(a.direction, schema)
      var cb = coverageOf(b.direction, schema)
      if (!intersects(ca, cb)) continue

      issues.push({
        severity: covers(ca, cb) ? "shadowed" : "overlap",
        index: later,
        otherIndex: earlier,
        fingers: b.fingers,
        direction: b.direction,
        otherDirection: a.direction,
        managed: !!b.managed,
        otherManaged: !!a.managed
      })
    }
  }
  return issues
}

// Field-level problems the compositor would reject, or silently ignore.
function findFieldErrors(gestures, schema) {
  var errors = []
  for (var i = 0; i < gestures.length; i++) {
    var g = gestures[i]
    if (!schema.isValidDirection(g.direction))
      errors.push({ index: i, text: 'Not a direction Hyprland knows: "' + g.direction + '"' })
    else if (!schema.isValidAction(g.action))
      errors.push({ index: i, text: 'Not an action Hyprland knows: "' + g.action + '"' })
    if (g.fingers < schema.FINGERS_MIN)
      errors.push({ index: i, text: "Hyprland needs at least " + schema.FINGERS_MIN + " fingers" })
    else if (g.fingers > schema.FINGERS_MAX)
      errors.push({ index: i, text: "Hyprland takes at most " + schema.FINGERS_MAX + " fingers" })
    // Argument text becomes Lua in the file, so a typo takes the whole config
    // down. read.lua --check is the real gate; this greys out Save first.
    if (schema.isDispatchAction(g.action)) {
      var badArgs = badLuaArgs(g.dispatch_args)
      if (badArgs) errors.push({ index: i, text: "The argument text " + badArgs })
    }

    // The guard is only offered where the generated Lua can be got right, so a
    // gesture carrying it anywhere else came from a hand-edit and would write
    // out a call the helper cannot honour.
    if (g.double && !schema.canDouble(g.action, g.direction))
      errors.push({ index: i, text: "A double swipe only guards "
        + schema.GUARDABLE_ACTIONS.join(" or ") + ", and only on a swipe" })
    if (g.double && !(Number(g.double_within_ms) >= schema.FIELDS.double_within_ms.min
                      && Number(g.double_within_ms) <= schema.FIELDS.double_within_ms.max))
      errors.push({ index: i, text: "The gap between the two swipes must be "
        + schema.FIELDS.double_within_ms.min + "–"
        + schema.FIELDS.double_within_ms.max + " ms" })

    var bad = schema.badModifier(g.mods)
    if (bad)
      errors.push({ index: i, text: '"' + bad + '" is not a modifier — the gesture would never fire' })
    // A `special` gesture with no name is accepted by the parser -- it falls
    // back to the default special workspace -- so it is not an error here
    // either. The panel has no business refusing to save what Hyprland takes.
    if (schema.actionFields(g.action).indexOf("scale") !== -1
        && g.scale !== undefined && g.scale !== null && g.scale !== ""
        && !(Number(g.scale) > schema.SCALE_MIN && Number(g.scale) <= schema.SCALE_MAX))
      errors.push({ index: i, text: "Scale must be over " + schema.SCALE_MIN
        + " and at most " + schema.SCALE_MAX })
  }
  return errors
}
