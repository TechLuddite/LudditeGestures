import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Schema.js" as Schema
import "LuaGestures.js" as Lua

// Luddite Gestures — a GUI for the touchpad gestures in ~/.config/hypr/input.lua.
//
// The panel owns one fenced block and nothing else. Gestures written by hand
// outside that block are read, shown, and counted when looking for conflicts,
// but never rewritten: an action that is a Lua callback cannot survive a
// dropdown, and quietly flattening one would be the worst thing this could do.
//
// There is no live preview. Hyprland has no way to unregister a gesture, so
// evaluating a draft would stack it on top of the real ones rather than replace
// them. Saving writes the file and reloads, which is the only honest preview a
// gesture has anyway — you have to put fingers on the touchpad to feel it.
Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginDir: (manifest && manifest.__sourceDir)
    || (home + "/.config/omarchy/plugins/io.github.techluddite.gestures")
  readonly property string inputPath: home + "/.config/hypr/input.lua"

  property bool opened: false

  // What the panel manages.
  property var gestures: []
  property var tunables: ({})

  // What the rest of input.lua declares, in the order Hyprland reads it.
  property var unmanagedBefore: []
  property var unmanagedAfter: []

  // Callback gestures found between the fences. They are neither editable nor
  // safe: saving rewrites the whole block and would drop them, so they get
  // their own bucket and their own warning rather than being listed with the
  // hand-written gestures the panel really does leave alone.
  property var unmanagedInBlock: []

  // The three segments of input.lua are read by three concurrent processes.
  // Nothing is published until all three have answered -- otherwise whichever
  // finished last would overwrite the others.
  property var pendingRead: null

  // The last state known to match disk, for Revert and for the dirty flag.
  property var savedGestures: []
  property var savedTunables: ({})

  property string statusText: ""
  property string errorText: ""
  property bool selfWrite: false
  property bool readFailed: false

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color accent: Color.accent
  property color urgent: Color.urgent
  property color scrim: Color.menu.scrim
  property string fontFamily: Style.font.menuFamily

  readonly property bool dirty:
    JSON.stringify(gestures) !== JSON.stringify(savedGestures)
    || JSON.stringify(tunables) !== JSON.stringify(savedTunables)

  // Every gesture Hyprland will see, in file order, tagged with where it came
  // from so a warning can name the right one.
  readonly property var ordered: {
    var out = []
    var i
    for (i = 0; i < unmanagedBefore.length; i++) out.push(tag(unmanagedBefore[i], false, i))
    for (i = 0; i < gestures.length; i++) out.push(tag(gestures[i], true, i))
    for (i = 0; i < unmanagedInBlock.length; i++) out.push(tag(unmanagedInBlock[i], false, i))
    for (i = 0; i < unmanagedAfter.length; i++) out.push(tag(unmanagedAfter[i], false, i))
    return out
  }

  readonly property var conflicts: Lua.findConflicts(ordered, Schema)
  readonly property var fieldErrors: Lua.findFieldErrors(gestures, Schema)
  readonly property var unmanaged: unmanagedBefore.concat(unmanagedAfter)
  readonly property bool blocked: fieldErrors.length > 0

  function tag(g, managed, sourceIndex) {
    return {
      fingers: g.fingers, direction: g.direction, action: g.action,
      mode: g.mode || "", mods: g.mods || "",
      workspace_name: g.workspace_name || "", custom: !!g.custom,
      scale: Number(g.scale) || 0, zoom_level: g.zoom_level || "",
      // Never edited here, only carried, so a hand-written one survives a save.
      disable_inhibit: !!g.disable_inhibit,
      double: !!g.double, double_within_ms: Number(g.double_within_ms) || 0,
      double_min_distance: Number(g.double_min_distance) || 0,
      double_hint: g.double_hint || "",
      managed: managed, sourceIndex: sourceIndex
    }
  }

  function copyGesture(g) { return tag(g, true, 0) }

  // --------------------------------------------------------------- lifecycle

  function open() { opened = true; inputFile.reload() }
  function dismiss() { opened = false; statusText = "" }
  function toggle() { opened ? dismiss() : open() }

  // ------------------------------------------------------------------ reading

  // input.lua is read in three pieces so the block's position in the file — and
  // therefore which gestures Hyprland registers first — survives the round trip.
  function readFile(text) {
    var split = Lua.splitBlock(text)
    root.readFailed = false
    root.pendingRead = { before: null, body: null, after: null }
    beforeReader.command = ["lua", pluginDir + "/read.lua", "-e", split.before]
    beforeReader.running = true
    afterReader.command = ["lua", pluginDir + "/read.lua", "-e", split.after]
    afterReader.running = true
    bodyReader.command = ["lua", pluginDir + "/read.lua", "-e", split.found ? split.body : ""]
    bodyReader.running = true
  }

  // One segment came back. Publishing early would mean the reader that finished
  // last silently won, so hold everything until the set is complete.
  function segmentRead(which, parsed) {
    if (!root.pendingRead) return
    root.pendingRead[which] = parsed
    var p = root.pendingRead
    if (!p.before || !p.body || !p.after) return
    root.pendingRead = null
    adopt(p)
  }

  function adopt(p) {
    var managed = []
    var inBlock = []
    var i
    for (i = 0; i < p.body.gestures.length; i++) {
      // A callback gesture inside the fence is not something the panel wrote,
      // and not something it can edit -- or keep, once the block is rewritten.
      if (p.body.gestures[i].custom) { inBlock.push(p.body.gestures[i]); continue }
      var g = copyGesture(p.body.gestures[i])
      // Hyprland takes "l" and "ZOOMIN" where the dropdown says "left" and
      // "pinchin". Same gesture; the dropdown needs the name it offers.
      g.direction = Schema.canonicalDirection(g.direction)
      // Hyprland accepts a fullscreen gesture with no mode; the dropdown needs
      // one to show, and writing it back explicitly changes nothing.
      if (Schema.actionFields(g.action).indexOf("mode") !== -1 && !g.mode) g.mode = Schema.defaultMode()
      managed.push(g)
    }

    var t = {}
    for (var k = 0; k < Schema.TUNABLES.length; k++) {
      var spec = Schema.TUNABLES[k]
      var raw = p.body.tunables[spec.key]
      if (raw === undefined) { t[spec.key] = spec.def; continue }
      t[spec.key] = spec.scale ? Math.round(Number(raw) * spec.scale) : raw
    }

    root.unmanagedBefore = p.before.gestures
    root.unmanagedInBlock = inBlock
    root.unmanagedAfter = p.after.gestures
    root.gestures = managed
    root.tunables = t
    root.savedGestures = JSON.parse(JSON.stringify(managed))
    root.savedTunables = JSON.parse(JSON.stringify(t))
  }

  // -------------------------------------------------------------- mutation

  function editGesture(index, field, value) {
    if (index < 0 || index >= gestures.length) return
    var next = JSON.parse(JSON.stringify(gestures))
    var numeric = ["fingers", "scale", "double_within_ms", "double_min_distance"]
    next[index][field] = numeric.indexOf(field) !== -1 ? Number(value) : value
    // Dropping to an action that does not take a field should not leave the old
    // value behind to be written out again; picking one that does should not
    // leave it blank, so what the row shows is what the file will say.
    if (field === "action") {
      var fields = Schema.actionFields(value)
      for (var k = 0; k < Schema.FIELD_NAMES.length; k++) {
        var name = Schema.FIELD_NAMES[k]
        if (fields.indexOf(name) === -1) next[index][name] = Schema.fieldEmpty(name)
        else if (!next[index][name]) next[index][name] = Schema.fieldDefault(name)
      }
    }

    // The guard only exists for some action/direction pairs, so changing either
    // can take it away -- and it must not be left set on a gesture that would
    // then write a call the helper cannot honour. Turning it on fills in the
    // knobs, for the same reason a fullscreen action gets an explicit mode.
    var g = next[index]
    if (!Schema.canDouble(g.action, g.direction)) g.double = false
    if (!g.double) {
      for (var e = 0; e < Schema.DOUBLE_FIELDS.length; e++)
        g[Schema.DOUBLE_FIELDS[e]] = Schema.fieldEmpty(Schema.DOUBLE_FIELDS[e])
    } else if (field === "double") {
      // Just switched on, so every knob starts at its default. They are filled
      // unconditionally rather than only when unset: switching the guard off
      // clears them, so there is nothing here worth preserving, and a zero
      // travel floor is a real setting that "unset" cannot be told apart from.
      for (var d = 0; d < Schema.DOUBLE_FIELDS.length; d++)
        g[Schema.DOUBLE_FIELDS[d]] = Schema.fieldDefault(Schema.DOUBLE_FIELDS[d])
    }
    root.gestures = next
    root.statusText = ""
  }

  function addGesture() {
    var next = JSON.parse(JSON.stringify(gestures))
    next.push({ fingers: 3, direction: "up", action: "close",
                mode: "", mods: "", workspace_name: "", scale: 0, zoom_level: "",
                disable_inhibit: false, custom: false,
                double: false, double_within_ms: 0, double_min_distance: 0,
                double_hint: "" })
    root.gestures = next
    root.statusText = ""
  }

  function removeGesture(index) {
    var next = JSON.parse(JSON.stringify(gestures))
    next.splice(index, 1)
    root.gestures = next
    root.statusText = ""
  }

  function setTunable(key, value) {
    var next = JSON.parse(JSON.stringify(tunables))
    next[key] = value
    root.tunables = next
    root.statusText = ""
  }

  function revert() {
    root.gestures = JSON.parse(JSON.stringify(savedGestures))
    root.tunables = JSON.parse(JSON.stringify(savedTunables))
    root.statusText = "Reverted"
    statusClear.restart()
  }

  // --------------------------------------------------------------- saving

  // A dispatcher gesture carries argument text the user typed, and that text
  // lands in the file as Lua. One typo there would be a syntax error in the
  // whole of input.lua -- taking the rest of the config down with it, and
  // leaving the panel with nothing to show you but an unreadable block. So the
  // rendered body is compiled before any of it is written, and a body that does
  // not compile is refused rather than saved and apologised for afterwards.
  property string pendingBody: ""

  function save() {
    if (blocked) { root.statusText = "Fix the errors above first"; return }
    root.errorText = ""
    root.statusText = "Checking…"
    root.pendingBody = Lua.renderBody(gestures, tunables, Schema)
    checkProc.command = ["lua", pluginDir + "/read.lua", "--check", "-e", root.pendingBody]
    checkProc.running = true
  }

  function writeChecked() {
    root.statusText = "Saving…"
    root.selfWrite = true
    inputFile.setText(Lua.applyBlock(inputFile.text(), root.pendingBody))
    root.pendingBody = ""
  }

  function noteSaved() {
    root.savedGestures = JSON.parse(JSON.stringify(gestures))
    root.savedTunables = JSON.parse(JSON.stringify(tunables))
    root.selfWrite = false
    reloadProc.running = true
  }

  // --------------------------------------------------------------- processes

  Process {
    id: bodyReader
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.segmentRead("body", Lua.parseHarness(text)) }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (String(text || "").trim() !== "") {
        root.readFailed = true
        root.errorText = "Could not read the managed block: " + String(text).trim()
      }
    }
  }

  Process {
    id: beforeReader
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.segmentRead("before", Lua.parseHarness(text))
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (String(text || "").trim() !== "") {
        root.readFailed = true
        root.errorText = "input.lua did not parse: " + String(text).trim()
      }
    }
  }

  Process {
    id: afterReader
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.segmentRead("after", Lua.parseHarness(text))
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (String(text || "").trim() !== "") {
        root.readFailed = true
        root.errorText = "input.lua did not parse: " + String(text).trim()
      }
    }
  }

  // Compiles the block the save is about to write. Nothing is printed on
  // success, so the exit status is the whole answer; stderr carries Lua's own
  // message, which names the line and says what it choked on.
  Process {
    id: checkProc
    stderr: StdioCollector { waitForEnd: true }
    onExited: function (code) {
      if (code === 0) { root.writeChecked(); return }
      root.pendingBody = ""
      root.statusText = ""
      var detail = String(checkProc.stderr.text || "").trim()
      root.errorText = "Not saved — that would not compile: "
        + (detail !== "" ? detail : "the block is not valid Lua")
    }
  }

  Process {
    id: reloadProc
    command: ["hyprctl", "reload"]
    onExited: errorsProc.running = true
  }

  // Hyprland is the last word on whether the file it just read is good.
  Process {
    id: errorsProc
    command: ["hyprctl", "configerrors"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var out = String(text || "").trim()
        root.errorText = (out === "" || out === "no errors") ? "" : out
        if (root.errorText === "") { root.statusText = "Saved"; statusClear.restart() }
        else root.statusText = ""
      }
    }
  }

  Timer { id: statusClear; interval: 2500; onTriggered: root.statusText = "" }

  FileView {
    id: inputFile
    path: root.inputPath
    atomicWrites: true
    printErrors: false
    watchChanges: true
    onLoaded: root.readFile(text())
    onLoadFailed: {
      root.errorText = "Could not read " + root.inputPath
      root.readFailed = true
    }
    onSaved: root.noteSaved()
    onSaveFailed: {
      root.selfWrite = false
      root.statusText = ""
      root.errorText = "Could not write " + root.inputPath
    }
    // Adopt an edit made elsewhere rather than overwriting it from a stale
    // copy — but never while there are unsaved changes to yank away.
    onFileChanged: if (!root.selfWrite && !root.dirty) reload()
  }

  // -------------------------------------------------------------------- UI

  PanelWindow {
    id: window
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "luddite-gestures"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle {
      anchors.fill: parent
      color: root.scrim
      MouseArea { anchors.fill: parent; onClicked: root.dismiss() }
    }

    BorderSurface {
      id: card
      anchors.centerIn: parent
      width: Math.min(Style.space(980), window.width - Style.gapsOut * 4)
      height: Math.min(Style.space(680), window.height - Style.gapsOut * 4)
      radius: Style.cornerRadius
      color: root.background
      borderSpec: Border.surfaceSpec("menu", "border", Color.menu.border, Math.max(1, Style.space(2)))
      padding: Style.spacing.panelPadding

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        anchors.fill: parent
        focus: true
        Keys.onPressed: function (event) {
          if (event.key === Qt.Key_Escape) { root.dismiss(); event.accepted = true }
          else if (event.key === Qt.Key_S && (event.modifiers & Qt.ControlModifier)) {
            root.save(); event.accepted = true
          }
        }
      }

      ColumnLayout {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: Style.spacing.md

        // ---- header
        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          ColumnLayout {
            spacing: 0
            Text {
              text: "Luddite Gestures"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }
            Text {
              text: "~/.config/hypr/input.lua"
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Item { Layout.fillWidth: true }

          PanelActionButton {
            iconText: "󰅖"
            tooltipText: "Close (Esc)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.dismiss()
          }
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

        // ---- scrollable body
        Flickable {
          Layout.fillWidth: true
          Layout.fillHeight: true
          contentWidth: width
          contentHeight: body.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          ColumnLayout {
            id: body
            width: parent.width
            spacing: Style.spacing.md

            PanelSectionHeader {
              text: "Gestures"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Text {
              visible: root.gestures.length === 0
              Layout.fillWidth: true
              text: root.readFailed
                ? "input.lua could not be read, so nothing is shown. Fix the file and reopen."
                : "No gestures here yet. Add one below."
              color: root.foreground
              opacity: 0.6
              wrapMode: Text.WordWrap
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }

            // The model is the row COUNT, not the array. A Repeater fed a JS
            // array rebuilds every delegate whenever that array is reassigned,
            // and editGesture reassigns it on every keystroke -- so the control
            // being used was destroyed mid-signal, taking its open popup with
            // it. Counting instead leaves the delegates alone; `gesture` still
            // tracks the array, so each row redraws without being rebuilt.
            Repeater {
              model: root.gestures.length
              GestureRow {
                required property int index
                Layout.fillWidth: true
                gesture: root.gestures[index] || ({})
                rowIndex: index
                foreground: root.foreground
                accent: root.accent
                fontFamily: root.fontFamily
                onEdited: function (i, field, value) { root.editGesture(i, field, value) }
                onRemoved: function (i) { root.removeGesture(i) }
              }
            }

            Button {
              text: "Add gesture"
              iconText: "󰐕"
              bordered: true
              foreground: root.foreground
              accent: root.accent
              fontFamily: root.fontFamily
              onClicked: root.addGesture()
            }

            // ---- warnings
            Repeater {
              model: root.fieldErrors
              Text {
                required property var modelData
                Layout.fillWidth: true
                text: "✗  " + modelData.text
                color: root.urgent
                wrapMode: Text.WordWrap
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            Repeater {
              model: root.conflicts
              Text {
                required property var modelData
                Layout.fillWidth: true
                color: modelData.severity === "shadowed" ? root.urgent : root.foreground
                opacity: modelData.severity === "shadowed" ? 1.0 : 0.7
                wrapMode: Text.WordWrap
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                text: {
                  var who = modelData.otherManaged ? "an earlier gesture" : "a gesture written by hand"
                  var subject = modelData.fingers + "-finger " + Schema.directionLabel(modelData.direction).toLowerCase()
                  return modelData.severity === "shadowed"
                    ? "✗  " + subject + " never fires — " + who + " on "
                      + Schema.directionLabel(modelData.otherDirection).toLowerCase() + " already covers it."
                    : "!  " + subject + " overlaps " + who + " on "
                      + Schema.directionLabel(modelData.otherDirection).toLowerCase()
                      + "; the earlier one wins where they meet."
                }
              }
            }

            Text {
              visible: root.unmanagedInBlock.length > 0
              Layout.fillWidth: true
              color: root.urgent
              wrapMode: Text.WordWrap
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              text: "✗  " + root.unmanagedInBlock.length
                + (root.unmanagedInBlock.length === 1 ? " gesture inside" : " gestures inside")
                + " the managed block runs a Lua callback, which no dropdown can hold."
                + " Saving rewrites the block and would drop "
                + (root.unmanagedInBlock.length === 1 ? "it" : "them")
                + " — move it outside the fences to keep it."
            }

            // ---- hand-written
            PanelSectionHeader {
              visible: root.unmanaged.length > 0
              text: "Written by hand"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Text {
              visible: root.unmanaged.length > 0
              Layout.fillWidth: true
              text: "Also in input.lua, outside the block this panel owns. Shown so conflicts make sense; never edited or removed."
              color: root.foreground
              opacity: 0.6
              wrapMode: Text.WordWrap
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Repeater {
              model: root.unmanaged
              Text {
                required property var modelData
                Layout.fillWidth: true
                color: root.foreground
                opacity: 0.8
                wrapMode: Text.WordWrap
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                text: modelData.fingers + "-finger "
                  + Schema.directionLabel(modelData.direction).toLowerCase() + "  →  "
                  + (modelData.custom ? "a Lua callback" : Schema.actionLabel(modelData.action).toLowerCase())
              }
            }

            // ---- tunables
            PanelSectionHeader {
              text: "Feel"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Repeater {
              model: Schema.TUNABLES
              RowLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: Style.spacing.controlGap

                ColumnLayout {
                  Layout.fillWidth: true
                  spacing: 0
                  Text {
                    text: modelData.unit ? modelData.label + " (" + modelData.unit + ")" : modelData.label
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                  Text {
                    text: modelData.help
                    color: root.foreground
                    opacity: 0.55
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    Layout.minimumWidth: 0
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }

                ToggleSwitch {
                  visible: modelData.type === "bool"
                  Layout.minimumWidth: implicitWidth
                  Layout.preferredWidth: implicitWidth
                  checked: root.tunables[modelData.key] === true
                  foreground: root.foreground
                  accent: root.accent
                  onToggled: root.setTunable(modelData.key, !root.tunables[modelData.key])
                }

                NumberField {
                  id: numberField
                  visible: modelData.type !== "bool"
                  Layout.preferredWidth: Style.spacing.numberFieldWidth
                  Layout.minimumWidth: Style.spacing.numberFieldWidth
                  value: Number(root.tunables[modelData.key] || modelData.def)
                  from: modelData.min || 0
                  to: modelData.max || 1000
                  stepSize: modelData.step || 1
                  foreground: root.foreground
                  accent: root.accent
                  fontFamily: root.fontFamily
                  onModified: root.setTunable(modelData.key, numberField.value)
                }
              }
            }
          }
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground }

        // ---- footer
        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          Text {
            Layout.fillWidth: true
            text: root.errorText !== "" ? root.errorText : root.statusText
            color: root.errorText !== "" ? root.urgent : root.foreground
            opacity: root.errorText !== "" ? 1.0 : 0.7
            elide: Text.ElideRight
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Button {
            text: "Revert"
            bordered: true
            enabled: root.dirty
            opacity: root.dirty ? 1.0 : 0.4
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.revert()
          }

          Button {
            text: "Save"
            bordered: true
            active: root.dirty && !root.blocked
            enabled: root.dirty && !root.blocked
            opacity: (root.dirty && !root.blocked) ? 1.0 : 0.4
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.save()
          }
        }
      }
    }
  }

  IpcHandler {
    target: "luddite-gestures"
    function open(): void { root.open() }
    function close(): void { root.dismiss() }
    function toggle(): void { root.toggle() }
  }
}
