// Pure-JS tests for the two library files. QML's `.pragma library` header is
// stripped so node can evaluate them; nothing else about the modules changes.
//
//   node test/run.js

const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

const root = path.join(__dirname, "..")

function load(file, exports) {
  const src = fs.readFileSync(path.join(root, file), "utf8").replace(".pragma library", "")
  const module = {}
  new Function("__exports", src + "\n;Object.assign(__exports, {" + exports.join(",") + "});")(module)
  return module
}

const Schema = load("Schema.js", [
  "DIRECTIONS", "COVERAGE", "ACTIONS", "MODES", "MODIFIERS", "TUNABLES",
  "FINGERS_MIN", "FINGERS_MAX", "SCALE_MIN", "SCALE_MAX",
  "FIELDS", "FIELD_NAMES", "DIRECTION_ALIASES",
  "GUARDABLE_ACTIONS", "DOUBLE_DIRECTIONS", "DOUBLE_FIELDS", "canDouble",
  "tunableFor", "isValidDirection", "isValidAction",
  "actionFields", "badModifier", "defaultMode", "canonicalDirection",
  "fieldDefault", "fieldEmpty", "fieldSpec", "modsToList", "modsFromList",
  "directionLabel", "actionLabel"
])
const Lua = load("LuaGestures.js", [
  "BEGIN_FENCE", "END_FENCE", "renderGesture", "renderTunables", "renderBody",
  "renderBlock", "splitBlock", "applyBlock", "parseHarness", "findConflicts",
  "findFieldErrors", "luaString", "renderDoubleGesture", "DOUBLE_HELPER"
])

let failures = 0
function check(name, condition, detail) {
  if (condition) { console.log("  ok   " + name); return }
  failures++
  console.log("  FAIL " + name + (detail ? "\n         " + detail : ""))
}

// ---------------------------------------------------------------------------
// The shadow lattice, measured against Hyprland 0.56.2 by registering `prev`
// then `new` at an unused finger count and reading the parser's verdict. If a
// future Hyprland changes the rule, this table is what tells us.
// ---------------------------------------------------------------------------
console.log("\nshadow lattice (measured from Hyprland 0.56.2)")

// Measured one pair at a time with `hyprctl reload` between every cell: a
// registration that succeeds stays live and shadows the next probe, so a whole
// row read in one pass reports the wrong previous gesture.
const D = ["left", "right", "up", "down", "horizontal", "vertical", "swipe",
           "pinch", "pinchin", "pinchout"]
const MEASURED = {
  //           left right up   down horiz vert swipe pinch pIn  pOut
  left:       [1,   0,    0,   0,   0,    0,   0,    0,    0,   0],
  right:      [0,   1,    0,   0,   0,    0,   0,    0,    0,   0],
  up:         [0,   0,    1,   0,   0,    0,   0,    0,    0,   0],
  down:       [0,   0,    0,   1,   0,    0,   0,    0,    0,   0],
  horizontal: [1,   1,    0,   0,   1,    0,   0,    0,    0,   0],
  vertical:   [0,   0,    1,   1,   0,    1,   0,    0,    0,   0],
  swipe:      [1,   1,    1,   1,   1,    1,   1,    0,    0,   0],
  pinch:      [0,   0,    0,   0,   0,    0,   0,    1,    1,   1],
  pinchin:    [0,   0,    0,   0,   0,    0,   0,    0,    1,   0],
  pinchout:   [0,   0,    0,   0,   0,    0,   0,    0,    0,   1],
}

function coversPair(prev, next) {
  const outer = Schema.COVERAGE[prev], inner = Schema.COVERAGE[next]
  return inner.every(d => outer.indexOf(d) !== -1)
}

let latticeOk = true, latticeDetail = ""
for (const prev of D) {
  for (let i = 0; i < D.length; i++) {
    const expected = MEASURED[prev][i] === 1
    const actual = coversPair(prev, D[i])
    if (expected !== actual) {
      latticeOk = false
      latticeDetail += `\n         ${prev} -> ${D[i]}: expected ${expected}, got ${actual}`
    }
  }
}
check("coverage sets reproduce every cell of the measured lattice", latticeOk, latticeDetail)
check("every direction in the dropdown has a coverage set",
  Schema.DIRECTIONS.every(d => Array.isArray(Schema.COVERAGE[d.value])))
check("the dropdown offers every direction the lattice was measured on",
  D.every(d => Schema.DIRECTIONS.some(o => o.value === d))
    && Schema.DIRECTIONS.length === D.length)
check("swipe covers no pinch, and neither pinch half covers the other",
  Schema.COVERAGE.swipe.indexOf("pinchin") === -1
    && Schema.COVERAGE.pinchin.indexOf("pinchout") === -1
    && Schema.COVERAGE.pinch.indexOf("pinchout") !== -1)

// ---------------------------------------------------------------------------
// Hyprland's parser is case-insensitive and takes short forms. A config written
// by hand can say `direction = "l"`; before these, that read as an unknown
// direction, which both blocked the save and hid every conflict it was in.
console.log("\ndirection aliases (measured from the canonical name Hyprland reports back)")

const ALIASES = {
  l: "left", r: "right", u: "up", d: "down",
  L: "left", R: "right", U: "up", D: "down",
  LEFT: "left", Horizontal: "horizontal",
  horiz: "horizontal", vert: "vertical", VERT: "vertical",
  zoomin: "pinchin", zoomout: "pinchout",
}
let aliasOk = true, aliasDetail = ""
for (const [written, canonical] of Object.entries(ALIASES)) {
  if (Schema.canonicalDirection(written) !== canonical) {
    aliasOk = false
    aliasDetail += `\n         ${written}: expected ${canonical}, got ${Schema.canonicalDirection(written)}`
  }
}
check("every alias Hyprland accepts resolves to the name the panel offers", aliasOk, aliasDetail)
check("an aliased direction is a valid direction",
  Object.keys(ALIASES).every(a => Schema.isValidDirection(a)))
check("an aliased direction still shadows what it covers",
  Lua.findConflicts([
    { fingers: 3, direction: "horiz", action: "workspace" },
    { fingers: 3, direction: "l", action: "close" },
  ], Schema).length === 1)
check("an alias reads back with the label of the direction it names",
  Schema.directionLabel("zoomin") === Schema.directionLabel("pinchin"))
check("a direction that is not an alias is still rejected",
  !Schema.isValidDirection("sideways") && !Schema.isValidDirection("hor"))

// ---------------------------------------------------------------------------
console.log("\nrendering")

check("renders a minimal gesture",
  Lua.renderGesture({ fingers: 3, direction: "horizontal", action: "workspace" })
    === 'hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })')

check("omits empty optional fields",
  Lua.renderGesture({ fingers: 3, direction: "up", action: "close", mode: "", mods: "", workspace_name: "" })
    === 'hl.gesture({ fingers = 3, direction = "up", action = "close" })')

check("includes optional fields when set",
  Lua.renderGesture({ fingers: 4, direction: "up", action: "fullscreen", mode: "maximize", mods: "SUPER" })
    === 'hl.gesture({ fingers = 4, direction = "up", action = "fullscreen", mode = "maximize", mods = "SUPER" })')

// A mode written by hand must survive being read into a dropdown and written
// back out. An empty option value cannot represent "fullscreen", so there is
// none: every mode is explicit.
check("no mode option has an empty value",
  Schema.MODES.every(m => m.value !== ""))
check("defaultMode is one of the offered modes",
  Schema.MODES.some(m => m.value === Schema.defaultMode()))
check("an explicit fullscreen mode is written, not dropped",
  Lua.renderGesture({ fingers: 4, direction: "up", action: "fullscreen", mode: "fullscreen" })
    .indexOf('mode = "fullscreen"') !== -1)

// The parser types these three differently, and gets each wrong if the other
// shape is written: `field "scale": float type requires a number`, and
// `field "zoom_level": string type requires a string`.
check("scale is written as a bare Lua number, not a string",
  Lua.renderGesture({ fingers: 3, direction: "pinch", action: "scroll_move", scale: 1.5 })
    .indexOf("scale = 1.5") !== -1,
  Lua.renderGesture({ fingers: 3, direction: "pinch", action: "scroll_move", scale: 1.5 }))
check("zoom_level is written quoted, so a relative \"+0.5\" survives",
  Lua.renderGesture({ fingers: 3, direction: "pinch", action: "cursor_zoom", zoom_level: "+0.5" })
    .indexOf('zoom_level = "+0.5"') !== -1)
check("disable_inhibit is carried through even though nothing edits it",
  Lua.renderGesture({ fingers: 3, direction: "up", action: "close", disable_inhibit: true })
    .indexOf("disable_inhibit = true") !== -1)
check("an unset scale/zoom_level/disable_inhibit is omitted, not written empty",
  Lua.renderGesture({ fingers: 3, direction: "up", action: "close",
                      scale: 0, zoom_level: "", disable_inhibit: false })
    === 'hl.gesture({ fingers = 3, direction = "up", action = "close" })')

// Every action the compositor answers to, and only those. Probed with
// `hyprctl eval` until it stopped saying `unknown action`.
const MEASURED_ACTIONS = ["workspace", "move", "close", "fullscreen", "float",
                          "special", "resize", "scroll_move", "cursor_zoom"]
check("the panel offers every action Hyprland accepts",
  MEASURED_ACTIONS.every(a => Schema.isValidAction(a)),
  "missing: " + MEASURED_ACTIONS.filter(a => !Schema.isValidAction(a)).join(", "))
check("the panel offers nothing Hyprland would reject",
  Schema.ACTIONS.every(a => MEASURED_ACTIONS.indexOf(a.value) !== -1),
  "extra: " + Schema.ACTIONS.map(a => a.value).filter(v => MEASURED_ACTIONS.indexOf(v) === -1).join(", "))
check("every field an action asks for has a spec the row can draw",
  Schema.ACTIONS.every(a => a.fields.every(f => Schema.fieldSpec(f) !== null)))
check("every field with a spec is reset by one loop or the other",
  Object.keys(Schema.FIELDS).every(f =>
    Schema.FIELD_NAMES.indexOf(f) !== -1 || Schema.DOUBLE_FIELDS.indexOf(f) !== -1))
check("the action-field and guard-field lists do not overlap",
  Schema.FIELD_NAMES.every(f => Schema.DOUBLE_FIELDS.indexOf(f) === -1))
check("fingers spans the range the parser allows",
  Schema.FINGERS_MIN === 2 && Schema.FINGERS_MAX === 9)

// The modifier control edits a list; the file holds one string. Round-tripping
// has to be stable or an untouched gesture reads as an edit.
check("modifiers round-trip through the list the control edits",
  Schema.modsFromList(Schema.modsToList("SUPER+SHIFT")) === "SUPER+SHIFT")
check("modifiers come back in a fixed order, not click order",
  Schema.modsFromList(["SHIFT", "SUPER"]) === "SUPER+SHIFT")
check("a space-separated modifier string reads the same as a plus-separated one",
  Schema.modsFromList(Schema.modsToList("SUPER SHIFT")) === "SUPER+SHIFT")
check("no modifiers renders as no field at all",
  Schema.modsFromList([]) === "" && Schema.modsToList("").length === 0)

check("escapes quotes and backslashes in Lua strings",
  Lua.luaString('a"b\\c') === '"a\\"b\\\\c"',
  "got " + Lua.luaString('a"b\\c'))

check("tunables at their default are not written",
  Lua.renderTunables({ workspace_swipe_distance: 300 }, Schema) === "")

check("a percent tunable is written back as a fraction",
  Lua.renderTunables({ workspace_swipe_cancel_ratio: 70 }, Schema)
    .indexOf("workspace_swipe_cancel_ratio = 0.7") !== -1,
  Lua.renderTunables({ workspace_swipe_cancel_ratio: 70 }, Schema))

check("a percent tunable at its default is still omitted",
  Lua.renderTunables({ workspace_swipe_cancel_ratio: 50 }, Schema) === "")

check("tunables away from default are written",
  Lua.renderTunables({ workspace_swipe_distance: 500 }, Schema)
    .indexOf("workspace_swipe_distance = 500") !== -1)

// ---------------------------------------------------------------------------
// Hyprland matches one swipe at a time, so a "twice, quickly" guard has to be
// timed in Lua. The panel writes that Lua, which means it also has to be able to
// read it back -- otherwise a guarded gesture would return as an opaque callback
// and the checkbox would be a one-way door.
console.log("\ndouble-swipe guard")

const GUARDED = {
  fingers: 4, direction: "down", action: "close", mode: "", mods: "",
  workspace_name: "", scale: 0, zoom_level: "",
  double: true, double_within_ms: 700, double_min_distance: 40,
  double_hint: "Swipe down again to close",
}

check("the guard is offered for the zero-argument discrete actions",
  Schema.canDouble("close", "down") && Schema.canDouble("float", "left"))
check("the guard is refused for actions whose dispatcher takes an argument",
  !Schema.canDouble("fullscreen", "down") && !Schema.canDouble("special", "down"),
  "fullscreen/special dispatch with an argument this cannot pin down")
check("the guard is refused for the continuous actions",
  ["workspace", "move", "resize", "scroll_move", "cursor_zoom"]
    .every(a => !Schema.canDouble(a, "down")))
check("the guard is refused on a pinch, whose delta it cannot measure",
  !Schema.canDouble("close", "pinch") && !Schema.canDouble("close", "pinchin"))
check("the guard follows a direction alias to the same answer",
  Schema.canDouble("close", "d") === Schema.canDouble("close", "down"))
check("every guardable action is a real action",
  Schema.GUARDABLE_ACTIONS.every(a => Schema.isValidAction(a)))
check("every doubleable direction is a real direction",
  Schema.DOUBLE_DIRECTIONS.every(d => Schema.isValidDirection(d)))

check("a guarded gesture renders as a helper call, not a bare hl.gesture",
  Lua.renderDoubleGesture(GUARDED)
    === 'luddite.double({ fingers = 4, direction = "down", action = "close", '
      + 'within_ms = 700, min_distance = 40, hint = "Swipe down again to close" })',
  Lua.renderDoubleGesture(GUARDED))

const guardedBody = Lua.renderBody([GUARDED], {}, Schema)
check("the helper is written when something uses it",
  guardedBody.indexOf("function luddite.double(s)") !== -1)
check("the helper is not written when nothing does",
  Lua.renderBody([{ fingers: 3, direction: "up", action: "close" }], {}, Schema)
    .indexOf("luddite") === -1)
check("the helper is written once, however many gestures use it",
  Lua.renderBody([GUARDED, Object.assign({}, GUARDED, { fingers: 5 })], {}, Schema)
    .split("function luddite.double").length === 2)

// The line that makes the round trip work: under Hyprland the global is nil and
// the helper defines itself; under read.lua it is a recorder, so the definition
// is skipped and the calls report themselves as data.
check("the helper defers to a `luddite` the reader can provide",
  /^local luddite = luddite$/m.test(Lua.DOUBLE_HELPER)
    && /^if not luddite then$/m.test(Lua.DOUBLE_HELPER))
check("the helper only ever dispatches the argument-free dispatchers",
  (Lua.DOUBLE_HELPER.match(/hl\.dsp\.window\.(close|float)\(\)/g) || []).length === 2
    && Lua.DOUBLE_HELPER.indexOf("fullscreen") === -1)

// A guarded gesture still registers as an ordinary gesture of that direction, so
// it has to keep taking part in conflict detection.
check("a guarded gesture still shadows and is shadowed",
  Lua.findConflicts([
    { fingers: 4, direction: "vertical", action: "workspace" },
    Object.assign({}, GUARDED, { managed: true }),
  ], Schema).length === 1)

check("a guard on an action that cannot take one is an error",
  Lua.findFieldErrors([Object.assign({}, GUARDED, { action: "fullscreen" })], Schema)
    .some(e => e.text.indexOf("double swipe") !== -1))
check("a guard with an out-of-range gap is an error",
  Lua.findFieldErrors([Object.assign({}, GUARDED, { double_within_ms: 9000 })], Schema).length > 0)
check("a well-formed guard is not an error",
  Lua.findFieldErrors([GUARDED], Schema).length === 0)

// ---------------------------------------------------------------------------
console.log("\nfence splicing")

const original = [
  "-- personal config",
  'hl.gesture({ fingers = 4, direction = "down", action = function() end })',
  ""
].join("\n")

const withBlock = Lua.applyBlock(original, 'hl.gesture({ fingers = 3, direction = "up", action = "close" })')
check("adds a block to a file that has none", Lua.splitBlock(withBlock).found)
check("leaves the hand-written gesture untouched",
  withBlock.indexOf('action = function() end') !== -1)
check("keeps the original leading comment", withBlock.indexOf("-- personal config") !== -1)

const rewritten = Lua.applyBlock(withBlock, 'hl.gesture({ fingers = 5, direction = "down", action = "float" })')
check("rewrites only what is between the fences",
  rewritten.indexOf('direction = "up"') === -1
    && rewritten.indexOf('action = function() end') !== -1)
check("rewriting is stable, not cumulative",
  rewritten.split(Lua.BEGIN_FENCE).length === 2)

const removed = Lua.applyBlock(rewritten, "")
check("an empty body removes the block entirely", !Lua.splitBlock(removed).found)
check("removing the block preserves the rest of the file",
  removed.indexOf("-- personal config") !== -1
    && removed.indexOf('action = function() end') !== -1)

check("a file with a begin fence but no end fence is left alone",
  Lua.splitBlock("x\n" + Lua.BEGIN_FENCE + "\ny").found === false)

// ---------------------------------------------------------------------------
console.log("\nparsing read.lua output")

const parsed = Lua.parseHarness([
  ["g", "3", "horizontal", "workspace", "", "", "", "false", "", "", ""].join("\t"),
  ["g", "4", "down", "custom", "", "", "", "true", "", "", ""].join("\t"),
  ["g", "3", "pinch", "scroll_move", "", "", "", "false", "1.5", "", "true"].join("\t"),
  ["c", "workspace_swipe_distance", "number", "500"].join("\t"),
  ["c", "workspace_swipe_invert", "boolean", "false"].join("\t"),
].join("\n"))

check("parses gestures", parsed.gestures.length === 3)
check("parses finger counts as numbers", parsed.gestures[0].fingers === 3)
check("flags a callback gesture as custom", parsed.gestures[1].custom === true)
check("parses numeric tunables", parsed.tunables.workspace_swipe_distance === 500)
check("parses boolean tunables", parsed.tunables.workspace_swipe_invert === false)
check("parses scale as a number and disable_inhibit as a bool",
  parsed.gestures[2].scale === 1.5 && parsed.gestures[2].disable_inhibit === true)

// read.lua grew three trailing fields after the first release. Output from the
// older one still has to parse, or a stale plugin dir reads as an empty config.
const oldFormat = Lua.parseHarness(
  ["g", "3", "up", "fullscreen", "fullscreen", "SUPER", "", "false"].join("\t"))
check("a record from the pre-scale read.lua still parses",
  oldFormat.gestures.length === 1
    && oldFormat.gestures[0].mode === "fullscreen"
    && oldFormat.gestures[0].scale === 0
    && oldFormat.gestures[0].zoom_level === ""
    && oldFormat.gestures[0].disable_inhibit === false)

// ---------------------------------------------------------------------------
console.log("\nconflict detection")

const shadowed = Lua.findConflicts([
  { fingers: 3, direction: "horizontal", action: "workspace", managed: false },
  { fingers: 3, direction: "left", action: "close", managed: true },
], Schema)
check("a managed gesture shadowed by a hand-written one is caught",
  shadowed.length === 1 && shadowed[0].severity === "shadowed")

const overlap = Lua.findConflicts([
  { fingers: 3, direction: "left", action: "close", managed: false },
  { fingers: 3, direction: "horizontal", action: "workspace", managed: true },
], Schema)
check("a partial overlap is reported as the softer 'overlap'",
  overlap.length === 1 && overlap[0].severity === "overlap")

check("different finger counts never conflict",
  Lua.findConflicts([
    { fingers: 3, direction: "horizontal", action: "workspace" },
    { fingers: 4, direction: "left", action: "close" },
  ], Schema).length === 0)

check("a pinch shadows both of its halves",
  Lua.findConflicts([
    { fingers: 4, direction: "pinch", action: "close" },
    { fingers: 4, direction: "pinchin", action: "float" },
  ], Schema).length === 1)

check("the two pinch halves do not conflict with each other",
  Lua.findConflicts([
    { fingers: 4, direction: "pinchin", action: "close" },
    { fingers: 4, direction: "pinchout", action: "float" },
  ], Schema).length === 0)

check("swipe leaves both pinch halves alone",
  Lua.findConflicts([
    { fingers: 4, direction: "swipe", action: "close" },
    { fingers: 4, direction: "pinchin", action: "float" },
    { fingers: 4, direction: "pinchout", action: "resize" },
  ], Schema).length === 0)

check("pinch does not conflict with swipe",
  Lua.findConflicts([
    { fingers: 4, direction: "swipe", action: "close" },
    { fingers: 4, direction: "pinch", action: "float" },
  ], Schema).length === 0)

// ---------------------------------------------------------------------------
console.log("\nfield validation")

const errs = Lua.findFieldErrors([
  { fingers: 3, direction: "sideways", action: "workspace", mods: "" },
  { fingers: 1, direction: "up", action: "close", mods: "" },
  { fingers: 3, direction: "up", action: "close", mods: "HYPER" },
  { fingers: 10, direction: "up", action: "close", mods: "" },
  { fingers: 3, direction: "pinch", action: "scroll_move", scale: 20, mods: "" },
], Schema)

check("rejects an unknown direction", errs.some(e => e.index === 0))
check("rejects fewer than two fingers", errs.some(e => e.index === 1))
check("rejects a modifier Hyprland would silently ignore", errs.some(e => e.index === 2))
check("rejects more fingers than the parser takes", errs.some(e => e.index === 3))
check("rejects a scale outside the range the parser bounds", errs.some(e => e.index === 4))
check("accepts a scale inside that range",
  Lua.findFieldErrors([{ fingers: 3, direction: "pinch", action: "scroll_move",
                         scale: 1.5, mods: "" }], Schema).length === 0)

// The parser takes `special` with no name -- it falls back to the default
// special workspace -- so the panel has no business refusing to save it.
check("a special-workspace gesture with no name is allowed, as Hyprland allows it",
  Lua.findFieldErrors([{ fingers: 3, direction: "up", action: "special",
                         workspace_name: "", mods: "" }], Schema).length === 0)
check("a direction written the short way does not read as an error",
  Lua.findFieldErrors([{ fingers: 3, direction: "l", action: "close", mods: "" }], Schema).length === 0)
check("accepts a valid gesture",
  Lua.findFieldErrors([{ fingers: 3, direction: "horizontal", action: "workspace", mods: "SUPER" }], Schema).length === 0)
check("accepts both 'SUPER SHIFT' and 'SUPER+SHIFT'",
  Schema.badModifier("SUPER SHIFT") === "" && Schema.badModifier("SUPER+SHIFT") === "")

// ---------------------------------------------------------------------------
// A gesture row is the widest thing in the panel. Nothing warns you when it
// outgrows the card: the row just pushes the controls below it off the right
// edge, silently. So the arithmetic is checked here against the card width read
// out of Panel.qml.
//
// The row is two lines now -- trigger on top, the chosen action's details
// underneath -- which is what makes room for the modifier control without
// squeezing anything.
console.log("\nlayout arithmetic")

// Defaults from the shell's Commons/Style.qml. A user theme can scale these,
// but the ratio is what matters and it does not change.
const STYLE = { dropdownWidth: 240, numberFieldWidth: 120, controlGap: 8, panelPadding: 18 }
const ACTION_BUTTON = 32

const panelSrc = fs.readFileSync(path.join(root, "Panel.qml"), "utf8")
const cardMatch = panelSrc.match(/width:\s*Math\.min\(Style\.space\((\d+)\)/)
check("the card width is readable from Panel.qml", !!cardMatch)

if (cardMatch) {
  const card = Number(cardMatch[1])
  const available = card - 2 * STYLE.panelPadding

  // Line one: fingers + direction + action + modifiers + remove button.
  const trigger = STYLE.numberFieldWidth + 3 * STYLE.dropdownWidth + ACTION_BUTTON
    + 4 * STYLE.controlGap
  check("the trigger line of a gesture row fits the card at full control widths",
    trigger <= available,
    `line needs ${trigger}px, card offers ${available}px`)

  // Line two carries either the action's own field or the double-swipe guard,
  // never both -- every guardable action has no fields of its own, which is the
  // property that keeps this line to one case at a time.
  check("no action asks for more fields than the detail line was sized for",
    Schema.ACTIONS.every(a => a.fields.length <= 1),
    "widest: " + Math.max(...Schema.ACTIONS.map(a => a.fields.length)))
  check("a guardable action brings no field of its own, so the two never collide",
    Schema.GUARDABLE_ACTIONS.every(v => Schema.actionFields(v).length === 0))

  const TOGGLE = 44
  const detailField = STYLE.dropdownWidth + STYLE.panelPadding
  // Guard: the toggle, the gap, the travel floor, and the hint.
  const detailGuard = TOGGLE + 2 * STYLE.numberFieldWidth + STYLE.dropdownWidth
    + 3 * STYLE.controlGap + STYLE.panelPadding
  check("the detail line fits the card with an action field",
    detailField <= available, `line needs ${detailField}px, card offers ${available}px`)
  check("the detail line fits the card with the guard fully open",
    detailGuard <= available, `line needs ${detailGuard}px, card offers ${available}px`)

  // And if a theme scales things up, the row must still be able to shrink
  // rather than shove the sections below it off-screen.
  const rowSrc = fs.readFileSync(path.join(root, "GestureRow.qml"), "utf8")
  check("every wide control in a row can shrink",
    (rowSrc.match(/Layout\.minimumWidth/g) || []).length >= 11,
    "each Dropdown/TextField/MultiSelect needs a Layout.minimumWidth")
  check("no control in a row is pinned with a fixed width",
    !/^\s*width:\s*Style\.spacing\.dropdownWidth/m.test(rowSrc))
}

// ---------------------------------------------------------------------------
// `index` is the name a Repeater injects into its delegate. A component used as
// a delegate must not also declare a property called `index`: the two collide,
// QML says nothing, and every row silently reports 0 -- so editing any row
// writes to the first one. This is a source check because the failure lives in
// QML's name resolution, where no pure-JS test can reach it.
console.log("\ndelegate index wiring")

const rowSrc = fs.readFileSync(path.join(root, "GestureRow.qml"), "utf8")
const panelQml = fs.readFileSync(path.join(root, "Panel.qml"), "utf8")

check("GestureRow does not declare a property named `index`",
  !/^\s*property\s+\w+\s+index\b/m.test(rowSrc))
check("GestureRow does not read `index` off itself",
  !/\brow\.index\b/.test(rowSrc))
check("the delegate does not self-assign index",
  !/^\s*index:\s*index\s*$/m.test(panelQml))
check("the delegate passes the injected index through to rowIndex",
  /^\s*rowIndex:\s*index\s*$/m.test(panelQml))
check("GestureRow emits the row number it was given",
  (rowSrc.match(/row\.(edited|removed)\(row\.rowIndex/g) || []).length >= 9,
  "every control must report rowIndex")

// ---------------------------------------------------------------------------
// A Repeater fed a JS array rebuilds every delegate whenever that array is
// reassigned -- measured: 3 rows in, 3 destroyed and 3 rebuilt per edit. Since
// editGesture reassigns on every keystroke, the control being used was torn
// down inside its own signal handler, with its popup still open. Feeding the
// Repeater the row COUNT instead destroys nothing while the length holds, and
// the delegate still tracks the array through `root.gestures[index]`.
//
// Source checks again: the failure is in Repeater's model semantics, which no
// pure-JS test can reach.
console.log("\ngesture table stability")

check("the gesture Repeater is driven by the row count, not the array",
  /model:\s*root\.gestures\.length\b/.test(panelQml))
check("no Repeater is fed the gestures array directly",
  !/model:\s*root\.gestures\s*$/m.test(panelQml))
check("the delegate reads its gesture out of the array by index",
  /gesture:\s*root\.gestures\[index\]/.test(panelQml))
check("the delegate does not depend on modelData, which a count model has none of",
  !/modelData/.test(panelQml.slice(panelQml.indexOf("model: root.gestures.length"),
                                   panelQml.indexOf("Add gesture"))))

// A control that assigns its own property destroys the binding that was on it.
// Every one of those has to put the binding back, or the row goes deaf to
// Revert and to edits made in the file.
const SELF_ASSIGNING = [
  ["Dropdown", /value = Qt\.binding/g, 3],
  ["MultiSelect", /values = Qt\.binding/g, 1],
  ["TextField", /text = Qt\.binding/g, 3],
]
for (const [what, pattern, count] of SELF_ASSIGNING) {
  check(`every ${what} in a row re-arms its binding after the user picks`,
    (rowSrc.match(pattern) || []).length === count,
    `expected ${count}, found ${(rowSrc.match(pattern) || []).length}`)
}

// ---------------------------------------------------------------------------
console.log("\nread.lua harness (integration)")

let lua = true
try { execFileSync("lua", ["-v"], { stdio: "ignore" }) } catch (e) { lua = false }

if (!lua) {
  console.log("  skip lua not installed")
} else {
  const fixture = [
    'hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })',
    'hl.gesture({ fingers = 4, direction = "up", action = "fullscreen", mode = "fullscreen" })',
    'hl.config({ gestures = { workspace_swipe_distance = 500 } })',
    // The shapes a GUI cannot represent, which must still read without error.
    'local n = 0',
    'hl.gesture({ fingers = 4, direction = "down", action = {',
    '  start = function() n = 0 end,',
    '  finish = function(e) hl.dispatch(hl.dsp.exec_cmd(o.notify("hi"))) end,',
    '} })',
    'o.window("(Alacritty)", { scroll_touchpad = 1.5 })',
    // The fields read.lua learned to report after the first release, plus a
    // direction written the short way Hyprland also accepts.
    'hl.gesture({ fingers = 2, direction = "l", action = "scroll_move", scale = 1.5 })',
    'hl.gesture({ fingers = 2, direction = "zoomin", action = "cursor_zoom", zoom_level = "+0.5",',
    '  disable_inhibit = true })',
  ].join("\n")

  const out = execFileSync("lua", [path.join(root, "read.lua"), "-e", fixture], { encoding: "utf8" })
  const state = Lua.parseHarness(out)

  check("reads gestures out of a realistic config", state.gestures.length === 5)
  check("reads a tunable set via hl.config", state.tunables.workspace_swipe_distance === 500)
  check("marks the callback-table gesture custom",
    state.gestures[2].custom === true && state.gestures[2].action === "custom")
  check("survives helper calls it does not implement",
    state.gestures[0].direction === "horizontal")

  check("reads scale off a scroll_move gesture",
    state.gestures[3].action === "scroll_move" && state.gestures[3].scale === 1.5)
  check("reads zoom_level and disable_inhibit off a cursor_zoom gesture",
    state.gestures[4].zoom_level === "+0.5" && state.gestures[4].disable_inhibit === true)
  check("reads a direction spelled the short way, verbatim",
    state.gestures[3].direction === "l" && Schema.canonicalDirection(state.gestures[3].direction) === "left")

  // A workspace name is free text from a text field. Render a hostile one, run
  // the result through Lua for real, and confirm it comes back as inert data:
  // one gesture, the payload intact as a name, and nothing executed.
  const HOSTILE = '"}) os.execute("touch ' + path.join(root, "test", "PWNED") + '") hl.gesture({'
  const hostileLua = Lua.renderGesture({
    fingers: 3, direction: "up", action: "special", workspace_name: HOSTILE
  })
  const hostileOut = execFileSync("lua", [path.join(root, "read.lua"), "-e", hostileLua], { encoding: "utf8" })
  const hostileState = Lua.parseHarness(hostileOut)

  check("a hostile workspace name stays one inert string",
    hostileState.gestures.length === 1 && hostileState.gestures[0].workspace_name === HOSTILE,
    JSON.stringify(hostileState.gestures))
  check("rendering a hostile name executes nothing",
    !fs.existsSync(path.join(root, "test", "PWNED")))

  // The regression that prompted this: a hand-written `mode = "fullscreen"`
  // read in, then written back, must come out byte-for-byte the same gesture.
  const original = 'hl.gesture({ fingers = 4, direction = "up", action = "fullscreen", mode = "fullscreen" })'
  const readBack = Lua.parseHarness(
    execFileSync("lua", [path.join(root, "read.lua"), "-e", original], { encoding: "utf8" }))
  const reRendered = Lua.renderGesture(readBack.gestures[0])
  check("a hand-written fullscreen mode survives a full round trip",
    reRendered === original, "got " + reRendered)

  // Same round trip for the fields that arrived later. scale must come back a
  // bare number and zoom_level a quoted string, or the parser rejects the line
  // it just wrote.
  const laterFields =
    'hl.gesture({ fingers = 2, direction = "pinchout", action = "scroll_move", scale = 1.5 })'
  const laterBack = Lua.parseHarness(
    execFileSync("lua", [path.join(root, "read.lua"), "-e", laterFields], { encoding: "utf8" }))
  check("a scale survives a full round trip as a number",
    Lua.renderGesture(laterBack.gestures[0]) === laterFields,
    "got " + Lua.renderGesture(laterBack.gestures[0]))

  const inhibit =
    'hl.gesture({ fingers = 2, direction = "up", action = "close", disable_inhibit = true })'
  const inhibitBack = Lua.parseHarness(
    execFileSync("lua", [path.join(root, "read.lua"), "-e", inhibit], { encoding: "utf8" }))
  check("disable_inhibit survives a save even though no control edits it",
    Lua.renderGesture(inhibitBack.gestures[0]) === inhibit,
    "got " + Lua.renderGesture(inhibitBack.gestures[0]))

  // The guard, end to end. This is the load-bearing one: the panel writes Lua
  // that Hyprland runs and that read.lua must hand back as editable data, or the
  // checkbox becomes a one-way door out of the dropdowns.
  const guarded = Lua.renderBody([{
    fingers: 4, direction: "down", action: "close", mods: "SUPER",
    double: true, double_within_ms: 700, double_min_distance: 40,
    double_hint: "Swipe down again to close",
  }], {}, Schema)
  const guardedBack = Lua.parseHarness(
    execFileSync("lua", [path.join(root, "read.lua"), "-e", guarded], { encoding: "utf8" }))

  check("a guarded gesture reads back as one gesture, not a callback",
    guardedBack.gestures.length === 1 && guardedBack.gestures[0].custom === false,
    JSON.stringify(guardedBack.gestures))
  check("a guarded gesture reads back with its guard intact",
    guardedBack.gestures[0].double === true
      && guardedBack.gestures[0].double_within_ms === 700
      && guardedBack.gestures[0].double_min_distance === 40
      && guardedBack.gestures[0].double_hint === "Swipe down again to close")
  check("a guarded gesture keeps its fingers, direction, action and mods",
    guardedBack.gestures[0].fingers === 4
      && guardedBack.gestures[0].direction === "down"
      && guardedBack.gestures[0].action === "close"
      && guardedBack.gestures[0].mods === "SUPER")
  check("a guarded gesture survives a full round trip byte-for-byte",
    Lua.renderBody(guardedBack.gestures, {}, Schema) === guarded)

  // The helper must also be real Lua that runs, not just Lua that parses --
  // under a plain interpreter the global is nil, so it defines itself and calls
  // through to the hl stubs.
  let helperRan = true
  try {
    execFileSync("lua", ["-e",
      "hl = setmetatable({}, { __index = function() return function() end end })\n"
      + "o = setmetatable({}, { __index = function() return function() end end })\n"
      + guarded], { stdio: "pipe" })
  } catch (e) { helperRan = false }
  check("the helper defines itself and runs when no reader is present", helperRan)

  // A file that is not valid Lua must fail loudly rather than read as empty.
  let threw = false
  try {
    execFileSync("lua", [path.join(root, "read.lua"), "-e", "hl.gesture({{{"], { stdio: "pipe" })
  } catch (e) { threw = true }
  check("a syntax error is an error, not a silent empty read", threw)
}

console.log(failures === 0 ? "\nall tests passed\n" : `\n${failures} test(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
