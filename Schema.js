.pragma library

// What Hyprland actually accepts, measured against Hyprland 0.56.2 by feeding
// candidates to `hyprctl eval` and reading the parser back:
//
//   hl.gesture: invalid direction "..."   direction is a closed set
//   hl.gesture: unknown action "..."      action is a closed set
//   field "fingers": ... minimum of 2     fingers starts at 2
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
  { value: "pinch",      label: "Pinch" }
]

// Which directions each one answers to. Hyprland refuses to register a gesture
// whose reach is already fully covered by an earlier one, and the coverage sets
// below reproduce that rule exactly -- see test/run.js, which asserts them
// against the lattice measured from the compositor.
var COVERAGE = {
  left:       ["left"],
  right:      ["right"],
  up:         ["up"],
  down:       ["down"],
  horizontal: ["left", "right", "horizontal"],
  vertical:   ["up", "down", "vertical"],
  pinch:      ["pinch"],
  swipe:      ["left", "right", "up", "down", "horizontal", "vertical", "swipe"]
}

// Every built-in action. `action` also accepts a Lua function, which is how
// hand-written gestures do anything else -- those are read and shown, never
// rewritten. `fields` is what the row offers beyond fingers/direction.
var ACTIONS = [
  { value: "workspace",  label: "Switch workspace",   fields: [] },
  { value: "move",       label: "Move window",        fields: [] },
  { value: "close",      label: "Close window",       fields: [] },
  { value: "fullscreen", label: "Fullscreen",         fields: ["mode"] },
  { value: "float",      label: "Toggle floating",    fields: [] },
  { value: "special",    label: "Special workspace",  fields: ["workspace_name"] },
  { value: "resize",     label: "Resize window",      fields: [] }
]

// Only meaningful for action = "fullscreen". Both values are written out
// explicitly rather than leaning on Hyprland's default for an omitted mode:
// a hand-written `mode = "fullscreen"` must survive a round trip through the
// panel unchanged, and an empty option value could not represent it.
var MODES = [
  { value: "fullscreen", label: "Fullscreen" },
  { value: "maximize",   label: "Maximize" }
]

// What a mode-taking action gets when it has none yet.
function defaultMode() { return "fullscreen" }

var MODIFIERS = ["SUPER", "SHIFT", "ALT", "CTRL"]

var FINGERS_MIN = 2
var FINGERS_MAX = 5

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
  for (var i = 0; i < DIRECTIONS.length; i++)
    if (DIRECTIONS[i].value === value) return DIRECTIONS[i].label
  return value
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

function isValidDirection(v) { return COVERAGE.hasOwnProperty(v) }

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
