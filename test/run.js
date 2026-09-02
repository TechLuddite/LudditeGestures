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
  "FINGERS_MIN", "FINGERS_MAX", "tunableFor", "isValidDirection", "isValidAction",
  "actionFields", "badModifier", "defaultMode"
])
const Lua = load("LuaGestures.js", [
  "BEGIN_FENCE", "END_FENCE", "renderGesture", "renderTunables", "renderBody",
  "renderBlock", "splitBlock", "applyBlock", "parseHarness", "findConflicts",
  "findFieldErrors", "luaString"
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

const D = ["left", "right", "up", "down", "horizontal", "vertical", "pinch", "swipe"]
const MEASURED = {
  //           left right up   down horiz vert pinch swipe
  left:       [1,   0,    0,   0,   0,    0,   0,    0],
  right:      [0,   1,    0,   0,   0,    0,   0,    0],
  up:         [0,   0,    1,   0,   0,    0,   0,    0],
  down:       [0,   0,    0,   1,   0,    0,   0,    0],
  horizontal: [1,   1,    0,   0,   1,    0,   0,    0],
  vertical:   [0,   0,    1,   1,   0,    1,   0,    0],
  pinch:      [0,   0,    0,   0,   0,    0,   1,    0],
  swipe:      [1,   1,    1,   1,   1,    1,   0,    1],
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
  ["g", "3", "horizontal", "workspace", "", "", "", "false"].join("\t"),
  ["g", "4", "down", "custom", "", "", "", "true"].join("\t"),
  ["c", "workspace_swipe_distance", "number", "500"].join("\t"),
  ["c", "workspace_swipe_invert", "boolean", "false"].join("\t"),
].join("\n"))

check("parses gestures", parsed.gestures.length === 2)
check("parses finger counts as numbers", parsed.gestures[0].fingers === 3)
check("flags a callback gesture as custom", parsed.gestures[1].custom === true)
check("parses numeric tunables", parsed.tunables.workspace_swipe_distance === 500)
check("parses boolean tunables", parsed.tunables.workspace_swipe_invert === false)

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
  { fingers: 3, direction: "up", action: "special", workspace_name: "", mods: "" },
], Schema)

check("rejects an unknown direction", errs.some(e => e.index === 0))
check("rejects fewer than two fingers", errs.some(e => e.index === 1))
check("rejects a modifier Hyprland would silently ignore", errs.some(e => e.index === 2))
check("requires a name for a special-workspace gesture", errs.some(e => e.index === 3))
check("accepts a valid gesture",
  Lua.findFieldErrors([{ fingers: 3, direction: "horizontal", action: "workspace", mods: "SUPER" }], Schema).length === 0)
check("accepts both 'SUPER SHIFT' and 'SUPER+SHIFT'",
  Schema.badModifier("SUPER SHIFT") === "" && Schema.badModifier("SUPER+SHIFT") === "")

// ---------------------------------------------------------------------------
// A gesture row is the widest thing in the panel, and it grows when an action
// brings its own field along. Nothing warns you when it outgrows the card: the
// row just pushes the controls below it off the right edge, silently. So the
// arithmetic is checked here against the card width read out of Panel.qml.
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
  // Fingers + direction + action + one contextual field + remove button.
  // Mode and workspace_name are mutually exclusive, so three wide controls.
  const widest = STYLE.numberFieldWidth + 3 * STYLE.dropdownWidth + ACTION_BUTTON
    + 4 * STYLE.controlGap
  const available = card - 2 * STYLE.panelPadding

  check("the widest gesture row fits the card at full control widths",
    widest <= available,
    `row needs ${widest}px, card offers ${available}px`)

  // And if a theme scales things up, the row must still be able to shrink
  // rather than shove the sections below it off-screen.
  const rowSrc = fs.readFileSync(path.join(root, "GestureRow.qml"), "utf8")
  check("every wide control in a row can shrink",
    (rowSrc.match(/Layout\.minimumWidth/g) || []).length >= 4,
    "each Dropdown/TextField needs a Layout.minimumWidth")
  check("no control in a row is pinned with a fixed width",
    !/^\s*width:\s*Style\.spacing\.dropdownWidth/m.test(rowSrc))
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
  ].join("\n")

  const out = execFileSync("lua", [path.join(root, "read.lua"), "-e", fixture], { encoding: "utf8" })
  const state = Lua.parseHarness(out)

  check("reads gestures out of a realistic config", state.gestures.length === 3)
  check("reads a tunable set via hl.config", state.tunables.workspace_swipe_distance === 500)
  check("marks the callback-table gesture custom",
    state.gestures[2].custom === true && state.gestures[2].action === "custom")
  check("survives helper calls it does not implement",
    state.gestures[0].direction === "horizontal")

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

  // A file that is not valid Lua must fail loudly rather than read as empty.
  let threw = false
  try {
    execFileSync("lua", [path.join(root, "read.lua"), "-e", "hl.gesture({{{"], { stdio: "pipe" })
  } catch (e) { threw = true }
  check("a syntax error is an error, not a silent empty read", threw)
}

console.log(failures === 0 ? "\nall tests passed\n" : `\n${failures} test(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
