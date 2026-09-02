# Luddite Gestures — working notes

A Quickshell panel plugin for Omarchy that edits Hyprland touchpad gestures in
`~/.config/hypr/input.lua`, and warns which of your swipes will never fire.

Read `README.md` first for what it does. This file is about how to change it
without breaking the two things that make it trustworthy: it tells the truth
about Hyprland, and it does not touch config it does not own.

## The discipline: measure, never quote

**Every fact about Hyprland in this repo was measured against a running
compositor, not read from documentation.** If you are adding or changing one,
measure it the same way and say so in the comment.

```bash
hyprctl eval 'hl.gesture({ fingers = 5, direction = "pinch", action = "x" })'
#   -> hl.gesture: unknown action "x"          the action set is closed
hyprctl repl 'return type(hl.dsp.window.close())'
#   -> userdata                                the dispatcher exists
```

- `Schema.js` `DIRECTIONS` / `ACTIONS` came from feeding candidates to the
  parser until it complained.
- `COVERAGE` is a 10×10 shadow lattice, pinned in `test/run.js`.
- `DISPATCHERS` was walked out of the live compositor with `pairs(hl.dsp)`.
- Field types (`scale` is a float bounded 0.1–10, `zoom_level` is a *string*)
  came from the parser's own error messages.

**Measuring the lattice needs `hyprctl reload` between every single cell.** A
probe that registers successfully stays live and shadows the next one, which
turns a whole row into confident nonsense. This was got wrong once: a
contaminated run reported that `swipe` shadows `pinchin`. It does not.

Where something could not be pinned down, the feature is not offered. The
double-swipe guard refuses `fullscreen` and `special` because dispatching
`hl.dsp.window.fullscreen("0")` and `("1")` both produced plain fullscreen, so
the argument looks ignored. Generating a call whose behaviour cannot be
predicted into someone's window manager config is not worth a checkbox.

## What the panel owns

One fenced block in `input.lua`, and nothing else:

```lua
-- >>> luddite-gestures managed block >>>
-- <<< luddite-gestures managed block <<<
```

Everything outside the fences is read for context, shown under **Written by
hand**, counted for conflicts, and never rewritten. An action that is a Lua
callback someone else wrote cannot survive three dropdowns, and flattening one
into an approximation would be the worst thing this could do.

The one exception, and it is signposted in the UI: a callback gesture found
*inside* the fences cannot be kept, because saving rewrites the block whole. It
gets its own warning rather than being listed among the gestures the panel
leaves alone.

## Architecture

| File | Role |
|---|---|
| `Schema.js` | What Hyprland accepts. Directions, coverage, actions, dispatchers, field specs, validation helpers. No I/O |
| `LuaGestures.js` | Renders the block, splices it into the file, parses `read.lua` output, finds conflicts and field errors. No I/O |
| `read.lua` | Runs a config segment against recording stubs and prints what it set |
| `Panel.qml` | State, the three-segment read, save, the UI |
| `GestureRow.qml` | One gesture, on two lines |
| `Service.qml` | Installs/removes the launcher desktop entry |

`Schema.js` and `LuaGestures.js` are `.pragma library` — pure JS, no QML types —
which is what lets `test/run.js` load them in node by stripping one line.

### Reading is Lua running Lua

`read.lua` does not parse. It executes the chunk against stubs that only record,
so there is no second grammar to keep in sync with Hyprland's, and a config
referencing helpers this plugin has never heard of still reads. Undefined
globals return an inert table that answers to being indexed and called.

Chunks load in text mode only (`load(src, name, "t")`), never as bytecode.

The file is read in **three segments** — before the block, the block, after it —
so the block's position, and therefore which gestures Hyprland registers first,
survives the round trip. Three processes run concurrently and **nothing is
published until all three have answered**. Publishing early meant whichever
reader finished last silently won; that was a real bug.

### Gestures the panel writes Lua for

Two kinds are not a plain `hl.gesture` call: a **dispatcher** gesture (runs what
a keybind runs) and a **guarded** one (`double`, fires on the second swipe).
Both are Lua callbacks, so the panel writes the callback rather than leaving you
to hand-write one it would then refuse to manage.

The trick that keeps them readable both ways is the helper's first line:

```lua
local luddite = luddite
if not luddite then ... end
```

Under Hyprland the global is nil, so the helper defines itself and registers
real gestures. Under `read.lua` it is a recorder, so the definition is skipped
and every `luddite.run(...)` call reports its arguments as data — which is how a
guarded or dispatcher gesture comes back into the dropdowns instead of reading
as an opaque callback.

**`read.lua` still records the old `luddite.double` name.** A block written by an
earlier version and not yet re-saved has to keep reading, or upgrading would
silently empty someone's gesture list.

The helper never names a dispatcher itself: it calls `s.run()`, a thunk the
renderer wrote. One place a wrong call can come from, and it is the one the
panel controls.

## Hard rules

1. **Nothing outside the fences is ever rewritten.** `applyBlock` splices; it
   does not reformat.
2. **A no-op save must be byte-identical.** Reading a config and saving it
   without edits may not change one character. Test it against a real file.
3. **Never write Lua you have not compiled.** Argument text for a dispatcher is
   raw Lua that lands in `input.lua`; one typo there is a syntax error in the
   *whole file*, which would take the rest of the config down and leave the panel
   with nothing to show but an unreadable block — including the gesture you need
   to fix. `save()` runs `read.lua --check` and refuses a body that will not
   parse. `--check` compiles and runs nothing; keep it that way, or every Save
   press executes the user's config.
4. **Do not be stricter than the parser.** A `special` gesture with no workspace
   name is accepted by Hyprland, so the panel accepts it too. Refusing to save
   something the compositor takes is a bug.
5. **Canonicalise directions on read, write the long form.** Hyprland takes `l`,
   `horiz`, `VERT`, `zoomin` and any casing. Treating those as unknown blocked
   saving and hid every conflict they were in.
6. **Explicit beats defaulted** when it has to round-trip. A hand-written
   `mode = "fullscreen"` must survive unchanged, which is why no `MODES` option
   has an empty value.
7. **Carry what you do not edit.** `disable_inhibit` has no control; it is read
   and written back so a hand-written one is not lost on save.
8. **There is no live preview, on purpose.** Hyprland offers no way to
   unregister a gesture, so evaluating a draft would stack it on top of the real
   ones instead of replacing them, and the preview would lie.

## Two QML traps that cost real time

Both are invisible: QML reports nothing, and the symptom looks like something
else entirely. Both are guarded by source-level checks in `test/run.js`, because
the failure lives where no pure-JS test can reach.

**A Repeater fed a JS array rebuilds every delegate when that array is
reassigned.** Measured: three rows in, three destroyed and three rebuilt per
edit. Since `editGesture` reassigns on every keystroke, the control being used
was destroyed inside its own signal handler, taking its open popup with it — the
whole gesture table fought back. The model is `root.gestures.length` and the
delegate reads `root.gestures[index]`. Do not change that back.

**Assigning a QML property destroys the binding on it.** `Dropdown` assigns
`value`, `MultiSelect` assigns `values`, `TextField` assigns `text`. Left alone,
a control shows the last edit forever and goes deaf to Revert and to changes made
in the file. Every self-assigning control re-arms with `Qt.binding()` straight
after telling the panel what changed.

Related: a delegate must not declare a property named `index`. A Repeater injects
one, the two collide silently, and every row reports 0 — so every edit lands on
the first gesture. Hence `rowIndex`.

## The marker that must not be renamed

`Service.qml` and `luddite-gestures.desktop` carry `X-LudditeGestures-Managed`.
It is a desktop-entry key, not a reference to the repository, and it survived the
rename to `luddite-gestures` deliberately.

Uninstall deletes a launcher entry **only if it carries that exact string**.
Change it and every entry already on disk is orphaned: the old one stops
matching, is never cleaned up, and keeps launching a plugin that is no longer
installed. It looks exactly like a stale name, which is why it is commented at
the site.

## Testing

```bash
node test/run.js          # 154 checks; no compositor needed
omarchy plugin validate . # what the shell enforces at install
```

`test/run.js` is deliberately three kinds of test in one file:

- **Pure JS** against the two libraries.
- **Source checks** on the `.qml` files, for the failures QML will not report.
- **Integration** through real `lua`, skipped with a note when it is absent.

When adding a feature that generates Lua, the load-bearing test is the round
trip: render it, run it through `read.lua`, render again, assert byte-identical.
And test the failure path — `--check` has a test that it compiles *without
executing a line*, because a check that cannot fail proves nothing.

## Working on it

Saving a file under `~/.config/omarchy/plugins/` hot-reloads plugin code but does
**not** re-instantiate a panel the shell has already created. A layout change
looks like it did nothing until `omarchy restart shell`.

Panel plugins load lazily — `shell.qml` only activates the Loader when the panel
is opened — so `luddite-gestures` missing from `quickshell ipc show` is normal
until you open it once. It is not a regression.

The shell's own components live in `/usr/share/omarchy/shell/{Commons,Ui}`. Read
them rather than guessing at their API; `qmllint -I <dir-containing-qs>` will
resolve them if you symlink the shell dir to `qs`.

## Style

Match the surrounding code. Comments explain *why*, especially where something
looks odd but is deliberate — the count-based Repeater model, the `Qt.binding()`
re-arms, `local luddite = luddite`, the `--check` pass before a write. Every one
of those exists because the obvious way was tried and was wrong.

Keep the measured provenance in the comment next to the value. A number without
the error message it came from is a number nobody can re-derive.
