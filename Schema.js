.pragma library

// What Hyprland actually accepts, measured against Hyprland 0.56.2 by feeding
// candidates to `hyprctl eval` and reading the parser back:
//
//   hl.gesture: invalid direction "..."   direction is a closed set
//   hl.gesture: unknown action "..."      action is a closed set
//   field "fingers": ... minimum of 2     fingers runs 2..9
//   field "scale": ... maximum of 10.00   scale is a float, 0.1 < s <= 10
//   field "zoom_level": string type       zoom_level is a string, not a number
//
// `mods` is NOT validated by the parser -- it accepts any string and silently
// never fires -- so the modifier list below is checked here instead.

var DIRECTIONS = [
  { value: "left",       label: "Swipe left" },
  { value: "right",      label: "Swipe right" },
  { value: "up",         label: "Swipe up" },
  { value: "down",       label: "Swipe down" },
  { value: "horizontal", label: "Swipe horizontally" },
  { value: "vertical",   label: "Swipe vertically" },
  { value: "swipe",      label: "Swipe any direction" },
  { value: "pinch",      label: "Pinch either way" },
  { value: "pinchin",    label: "Pinch in" },
  { value: "pinchout",   label: "Pinch out" }
]

// Hyprland's parser is case-insensitive and takes short forms, so a config
// written by hand can say `direction = "l"` where the panel says "left". Both
// name the same PINCH_IN/LEFT/... internally -- confirmed by registering each
// alias behind a known gesture and reading the canonical name back out of the
// "Previous X shadows new Y" message. Reading canonicalises; the panel only
// ever writes the long form, and only inside its own block.
var DIRECTION_ALIASES = {
  l: "left", r: "right", u: "up", d: "down",
  horiz: "horizontal", vert: "vertical",
  zoomin: "pinchin", zoomout: "pinchout"
}

function canonicalDirection(value) {
  var v = String(value === undefined || value === null ? "" : value).trim().toLowerCase()
  return DIRECTION_ALIASES.hasOwnProperty(v) ? DIRECTION_ALIASES[v] : v
}

// Which directions each one answers to. Hyprland refuses to register a gesture
// whose reach is already fully covered by an earlier one, and the coverage sets
// below reproduce that rule exactly -- see test/run.js, which asserts them
// against the 10x10 lattice measured from the compositor.
//
// Note that `swipe` covers every swipe but no pinch, and that `pinch` covers
// both pinch halves while neither half covers the other.
var COVERAGE = {
  left:       ["left"],
  right:      ["right"],
  up:         ["up"],
  down:       ["down"],
  horizontal: ["left", "right", "horizontal"],
  vertical:   ["up", "down", "vertical"],
  pinch:      ["pinch", "pinchin", "pinchout"],
  pinchin:    ["pinchin"],
  pinchout:   ["pinchout"],
  swipe:      ["left", "right", "up", "down", "horizontal", "vertical", "swipe"]
}

// Every built-in action. `action` also accepts a Lua function, which is how
// hand-written gestures do anything else -- those are read and shown, never
// rewritten. `fields` is what the row offers beyond fingers/direction.
var ACTIONS = [
  { value: "workspace",   label: "Switch workspace",   fields: [] },
  { value: "move",        label: "Move window",        fields: [] },
  { value: "close",       label: "Close window",       fields: [] },
  { value: "fullscreen",  label: "Fullscreen",         fields: ["mode"] },
  { value: "float",       label: "Toggle floating",    fields: [] },
  { value: "special",     label: "Special workspace",  fields: ["workspace_name"] },
  { value: "resize",      label: "Resize window",      fields: [] },
  { value: "scroll_move", label: "Scroll",             fields: ["scale"] },
  { value: "cursor_zoom", label: "Zoom the screen",    fields: ["zoom_level"] }
]

// ------------------------------------------------------- the double-swipe guard
//
// Hyprland matches one swipe at a time -- there is no double-swipe direction,
// and no field to ask for one. A "twice, quickly" guard has to be timed in Lua,
// which the panel writes for you (see LuaGestures.renderDoubleHelper) rather
// than leaving you to hand-write a callback it then refuses to manage.
//
// It is offered only where it can be got right:
//
//   * The action must be discrete AND dispatched with no argument. `close` and
//     `float` qualify. `fullscreen` and `special` do not: their dispatchers take
//     an argument whose Lua spelling could not be pinned down -- dispatching
//     hl.dsp.window.fullscreen("0") and ("1") produced the same real-fullscreen
//     state, so the argument appears to be ignored, and generating a call whose
//     behaviour cannot be predicted into someone's config is not worth a
//     checkbox. The continuous actions (workspace, move, resize, scroll_move,
//     cursor_zoom) track fingers 1:1 and have no "twice" to speak of.
//
//   * The direction must be a swipe. The guard measures how far the fingers
//     travelled, out of the `delta` on each update; a pinch reports its motion
//     differently, so the box stays hidden there.
var GUARDABLE_ACTIONS = ["close", "float"]
var DOUBLE_DIRECTIONS = ["left", "right", "up", "down", "horizontal", "vertical", "swipe"]

function canDouble(action, direction) {
  return GUARDABLE_ACTIONS.indexOf(action) !== -1
    && DOUBLE_DIRECTIONS.indexOf(canonicalDirection(direction)) !== -1
}

// The knobs the guard exposes, and what they start at. Defaults are the ones
// that were already working in a hand-written config on a real touchpad.
var DOUBLE_FIELDS = ["double_within_ms", "double_min_distance", "double_hint"]

// Only meaningful for action = "fullscreen". Both values are written out
// explicitly rather than leaning on Hyprland's default for an omitted mode:
// a hand-written `mode = "fullscreen"` must survive a round trip through the
// panel unchanged, and an empty option value could not represent it.
var MODES = [
  { value: "fullscreen", label: "Fullscreen" },
  { value: "maximize",   label: "Maximize" }
]

// The contextual controls a row grows when an action asks for one. `kind` is
// what the row draws; everything else is what that control needs.
//
// `scale` is a Lua float the parser bounds at 0.1 < s <= 10 (it rejects 0.1
// itself, on the float compare). A NumberField is integer-only, so it is edited
// as whole percent and divided back down on the way out -- the same trick the
// workspace_swipe_cancel_ratio tunable already uses.
//
// `zoom_level` really is a string to the parser, not a number, which is what
// lets it take a relative "+0.5" as well as an absolute "2".
var FIELDS = {
  mode: {
    kind: "choice", label: "Mode", options: MODES, def: "fullscreen"
  },
  workspace_name: {
    kind: "text", label: "Workspace", placeholder: "Workspace name", def: ""
  },
  scale: {
    kind: "percent", label: "Scale", unit: "%", scale: 100,
    min: 20, max: 1000, step: 10, def: 1
  },
  zoom_level: {
    kind: "text", label: "Zoom level", placeholder: "2, or +0.5", def: ""
  },
  double_within_ms: {
    kind: "int", label: "Within", unit: "ms",
    min: 200, max: 2000, step: 50, def: 700
  },
  double_min_distance: {
    kind: "int", label: "Min travel", unit: "px",
    min: 0, max: 400, step: 10, def: 40
  },
  double_hint: {
    kind: "text", label: "Hint after the first swipe",
    placeholder: "Leave empty for no hint", def: "Swipe again to confirm"
  }
}

// What a mode-taking action gets when it has none yet.
function defaultMode() { return "fullscreen" }

// The value a contextual field starts at when its action is first chosen.
// Written out explicitly, for the same reason MODES has no empty option.
function fieldDefault(name) {
  var spec = FIELDS[name]
  return spec ? spec.def : ""
}

function fieldSpec(name) { return FIELDS[name] || null }

// Every contextual field there is, and the value that means "not set" for each
// -- which is what renderGesture omits. Switching to an action that does not
// take a field resets it to this rather than leaving the old value behind to
// be written out again.
var FIELD_NAMES = ["mode", "workspace_name", "scale", "zoom_level"]

function fieldEmpty(name) {
  var spec = FIELDS[name]
  if (!spec) return ""
  return (spec.kind === "percent" || spec.kind === "int") ? 0 : ""
}

var MODIFIERS = ["SUPER", "SHIFT", "ALT", "CTRL"]

// Hyprland bounds fingers at 2..9. It is a touchpad, so the top of that range
// is theoretical, but the panel has no business being stricter than the parser.
var FINGERS_MIN = 2
var FINGERS_MAX = 9

var SCALE_MIN = 0.1
var SCALE_MAX = 10

// The gestures:* half of the config. These are still live in 0.56.2 (each was
// read back with `hyprctl getoption`), and they tune how a swipe feels rather
// than what it does, so they sit in their own section.
var TUNABLES = [
  { key: "workspace_swipe_distance", label: "Swipe distance", unit: "px", type: "int",
    min: 100, max: 1000, step: 20, def: 300,
    help: "Finger travel, in pixels, that adds up to one full workspace." },
  // Hyprland stores this as a 0..1 fraction; the panel edits whole percent,
  // because a NumberField is integer-only and "50%" reads better than "0.5".
  { key: "workspace_swipe_cancel_ratio", label: "Commit at", type: "percent", unit: "%",
    scale: 100, min: 10, max: 90, step: 5, def: 50,
    help: "How far through the swipe you must get for it to commit, in percent." },
  { key: "workspace_swipe_min_speed_to_force", label: "Flick speed", unit: "px/s", type: "int",
    min: 0, max: 100, step: 5, def: 30,
    help: "Speed that commits a swipe regardless of distance. 0 disables it." },
  { key: "workspace_swipe_direction_lock", label: "Direction lock", type: "bool",
    def: true, help: "Once a swipe picks an axis, keep it there." },
  { key: "workspace_swipe_create_new", label: "Create new workspace", type: "bool",
    def: true, help: "Swiping past the last workspace opens a fresh one." },
  { key: "workspace_swipe_forever", label: "Swipe forever", type: "bool",
    def: false, help: "Keep swiping past the ends instead of stopping." },
  { key: "workspace_swipe_invert", label: "Invert direction", type: "bool",
    def: true, help: "Natural-scrolling direction for workspace swipes." },
  { key: "close_max_timeout", label: "Close timeout", unit: "ms", type: "int",
    min: 0, max: 5000, step: 100, def: 1000,
    help: "How long Hyprland waits for a window to honour a close gesture." }
]

function directionLabel(value) {
  var v = canonicalDirection(value)
  for (var i = 0; i < DIRECTIONS.length; i++)
    if (DIRECTIONS[i].value === v) return DIRECTIONS[i].label
  return String(value)
}

function actionLabel(value) {
  for (var i = 0; i < ACTIONS.length; i++)
    if (ACTIONS[i].value === value) return ACTIONS[i].label
  return value
}

function actionFields(value) {
  for (var i = 0; i < ACTIONS.length; i++)
    if (ACTIONS[i].value === value) return ACTIONS[i].fields
  return []
}

function tunableFor(key) {
  for (var i = 0; i < TUNABLES.length; i++)
    if (TUNABLES[i].key === key) return TUNABLES[i]
  return null
}

function isValidDirection(v) { return COVERAGE.hasOwnProperty(canonicalDirection(v)) }

function isValidAction(v) {
  for (var i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].value === v) return true
  return false
}

// Splits on whitespace or '+', both of which Hyprland accepts, and reports the
// first token that is not a real modifier. Returns "" when the string is clean.
function badModifier(mods) {
  var raw = String(mods || "").trim()
  if (raw === "") return ""
  var parts = raw.split(/[\s+]+/)
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue
    if (MODIFIERS.indexOf(parts[i].toUpperCase()) === -1) return parts[i]
  }
  return ""
}

// The modifier control edits a list; the file stores one "SUPER+SHIFT" string.
function modsToList(mods) {
  var raw = String(mods || "").trim()
  if (raw === "") return []
  var parts = raw.split(/[\s+]+/)
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue
    out.push(parts[i].toUpperCase())
  }
  return out
}

// Kept in MODIFIERS order rather than click order, so the same set of keys
// always renders as the same string and never shows up as a spurious edit.
function modsFromList(values) {
  var picked = []
  for (var i = 0; i < MODIFIERS.length; i++)
    if ((values || []).indexOf(MODIFIERS[i]) !== -1) picked.push(MODIFIERS[i])
  return picked.join("+")
}
