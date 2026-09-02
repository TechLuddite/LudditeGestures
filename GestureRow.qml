import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Schema.js" as Schema

// One editable gesture, on two lines: what triggers it, then the details the
// chosen action actually uses. Contextual fields appear only for the actions
// that take them, so a row never shows a control Hyprland would ignore, and
// the detail line disappears entirely for the actions that take none.
//
// Every control here writes to its own property when the user touches it --
// Dropdown assigns `value`, MultiSelect assigns `values`, TextField assigns
// `text` -- and a QML property assignment destroys whatever binding was on it.
// Left alone, a dropdown would show the panel's last edit forever and quietly
// ignore Revert or a change made in the file. So each of those re-arms its
// binding with Qt.binding() straight after telling the panel what changed.
ColumnLayout {
  id: row

  property var gesture: ({})
  property int rowIndex: 0
  property color foreground: "white"
  property color accent: "white"
  property string fontFamily: ""

  signal edited(int row, string field, var value)
  signal removed(int row)

  readonly property var fields: Schema.actionFields(gesture.action || "")
  readonly property bool hasMode: fields.indexOf("mode") !== -1
  readonly property bool hasWorkspace: fields.indexOf("workspace_name") !== -1
  readonly property bool hasScale: fields.indexOf("scale") !== -1
  readonly property bool hasZoom: fields.indexOf("zoom_level") !== -1

  // Hyprland matches one swipe at a time, so "twice, quickly" is a guard the
  // panel writes as Lua. It is only offered where that Lua can be got right --
  // see Schema.canDouble.
  readonly property bool canDouble: Schema.canDouble(gesture.action || "", gesture.direction || "")
  readonly property bool isDouble: canDouble && gesture.double === true

  // Hyprland types scale as a float between 0.1 and 10; a NumberField is
  // integer-only, so the row edits whole percent and converts at the boundary.
  readonly property int scalePercent:
    Math.round((Number(gesture.scale) || Schema.fieldDefault("scale")) * Schema.FIELDS.scale.scale)

  spacing: Style.spacing.sm

  // ---- what triggers it
  RowLayout {
    Layout.fillWidth: true
    spacing: Style.spacing.controlGap

    NumberField {
      id: fingers
      label: "Fingers"
      value: row.gesture.fingers || Schema.FINGERS_MIN
      from: Schema.FINGERS_MIN
      to: Schema.FINGERS_MAX
      stepSize: 1
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onModified: row.edited(row.rowIndex, "fingers", fingers.value)
    }

    Dropdown {
      id: direction
      Layout.fillWidth: true
      Layout.preferredWidth: Style.spacing.dropdownWidth
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: Style.space(130)
      label: "Gesture"
      options: Schema.DIRECTIONS
      value: Schema.canonicalDirection(row.gesture.direction)
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onChanged: function (v) {
        row.edited(row.rowIndex, "direction", v)
        value = Qt.binding(function () { return Schema.canonicalDirection(row.gesture.direction) })
      }
    }

    Dropdown {
      id: action
      Layout.fillWidth: true
      Layout.preferredWidth: Style.spacing.dropdownWidth
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: Style.space(130)
      label: "Does"
      options: Schema.ACTIONS
      value: row.gesture.action || ""
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onChanged: function (v) {
        row.edited(row.rowIndex, "action", v)
        value = Qt.binding(function () { return row.gesture.action || "" })
      }
    }

    // Hyprland's parser takes any string here and a wrong one never fires, so
    // the list is closed on this side. Schema.badModifier still guards what a
    // hand-written config put in the file.
    MultiSelect {
      id: mods
      Layout.fillWidth: true
      Layout.preferredWidth: Style.spacing.dropdownWidth
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: Style.space(120)
      label: "Held keys"
      noSelectionText: "None"
      options: Schema.MODIFIERS
      values: Schema.modsToList(row.gesture.mods)
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onChanged: function (v) {
        row.edited(row.rowIndex, "mods", Schema.modsFromList(v))
        values = Qt.binding(function () { return Schema.modsToList(row.gesture.mods) })
      }
    }

    Item { Layout.fillWidth: true }

    PanelActionButton {
      iconText: "󰅖"
      tooltipText: "Remove this gesture"
      foreground: row.foreground
      fontFamily: row.fontFamily
      onClicked: row.removed(row.rowIndex)
    }
  }

  // ---- what the chosen action needs
  RowLayout {
    Layout.fillWidth: true
    Layout.leftMargin: Style.spacing.huge
    visible: row.fields.length > 0 || row.canDouble
    spacing: Style.spacing.controlGap

    Dropdown {
      id: mode
      visible: row.hasMode
      Layout.fillWidth: visible
      Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: visible ? Style.space(120) : 0
      label: Schema.FIELDS.mode.label
      options: Schema.MODES
      value: row.gesture.mode || ""
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onChanged: function (v) {
        row.edited(row.rowIndex, "mode", v)
        value = Qt.binding(function () { return row.gesture.mode || "" })
      }
    }

    ColumnLayout {
      visible: row.hasWorkspace
      Layout.fillWidth: visible
      Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: visible ? Style.space(120) : 0
      spacing: Style.spacing.labelGap

      Text {
        text: Schema.FIELDS.workspace_name.label
        color: Qt.darker(row.foreground, 1.4)
        font.family: row.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      TextField {
        id: workspaceName
        Layout.fillWidth: true
        placeholderText: Schema.FIELDS.workspace_name.placeholder
        text: row.gesture.workspace_name || ""
        foreground: row.foreground
        accent: row.accent
        font.family: row.fontFamily
        font.pixelSize: Style.font.body
        onEditingFinished: {
          row.edited(row.rowIndex, "workspace_name", workspaceName.text)
          text = Qt.binding(function () { return row.gesture.workspace_name || "" })
        }
      }
    }

    NumberField {
      id: scale
      visible: row.hasScale
      Layout.preferredWidth: visible ? Style.spacing.numberFieldWidth : 0
      Layout.minimumWidth: visible ? Style.spacing.numberFieldWidth : 0
      label: Schema.FIELDS.scale.label + " (" + Schema.FIELDS.scale.unit + ")"
      value: row.scalePercent
      from: Schema.FIELDS.scale.min
      to: Schema.FIELDS.scale.max
      stepSize: Schema.FIELDS.scale.step
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onModified: row.edited(row.rowIndex, "scale", scale.value / Schema.FIELDS.scale.scale)
    }

    ColumnLayout {
      visible: row.hasZoom
      Layout.fillWidth: visible
      Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: visible ? Style.space(120) : 0
      spacing: Style.spacing.labelGap

      Text {
        text: Schema.FIELDS.zoom_level.label
        color: Qt.darker(row.foreground, 1.4)
        font.family: row.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      // Free text on purpose: Hyprland types zoom_level as a string, which is
      // what lets it take a relative "+0.5" as well as an absolute "2".
      TextField {
        id: zoomLevel
        Layout.fillWidth: true
        placeholderText: Schema.FIELDS.zoom_level.placeholder
        text: row.gesture.zoom_level || ""
        foreground: row.foreground
        accent: row.accent
        font.family: row.fontFamily
        font.pixelSize: Style.font.body
        onEditingFinished: {
          row.edited(row.rowIndex, "zoom_level", zoomLevel.text)
          text = Qt.binding(function () { return row.gesture.zoom_level || "" })
        }
      }
    }

    // ---- the double-swipe guard
    ColumnLayout {
      visible: row.canDouble
      Layout.minimumWidth: visible ? Style.space(110) : 0
      spacing: Style.spacing.labelGap

      Text {
        text: "Twice, quickly"
        color: Qt.darker(row.foreground, 1.4)
        font.family: row.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      ToggleSwitch {
        checked: row.isDouble
        foreground: row.foreground
        accent: row.accent
        onToggled: row.edited(row.rowIndex, "double", !row.isDouble)
      }
    }

    NumberField {
      id: within
      visible: row.isDouble
      Layout.preferredWidth: visible ? Style.spacing.numberFieldWidth : 0
      Layout.minimumWidth: visible ? Style.spacing.numberFieldWidth : 0
      label: Schema.FIELDS.double_within_ms.label + " (" + Schema.FIELDS.double_within_ms.unit + ")"
      value: Number(row.gesture.double_within_ms) || Schema.fieldDefault("double_within_ms")
      from: Schema.FIELDS.double_within_ms.min
      to: Schema.FIELDS.double_within_ms.max
      stepSize: Schema.FIELDS.double_within_ms.step
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onModified: row.edited(row.rowIndex, "double_within_ms", within.value)
    }

    NumberField {
      id: travel
      visible: row.isDouble
      Layout.preferredWidth: visible ? Style.spacing.numberFieldWidth : 0
      Layout.minimumWidth: visible ? Style.spacing.numberFieldWidth : 0
      label: Schema.FIELDS.double_min_distance.label + " (" + Schema.FIELDS.double_min_distance.unit + ")"
      value: Number(row.gesture.double_min_distance) || 0
      from: Schema.FIELDS.double_min_distance.min
      to: Schema.FIELDS.double_min_distance.max
      stepSize: Schema.FIELDS.double_min_distance.step
      foreground: row.foreground
      accent: row.accent
      fontFamily: row.fontFamily
      onModified: row.edited(row.rowIndex, "double_min_distance", travel.value)
    }

    ColumnLayout {
      visible: row.isDouble
      Layout.fillWidth: visible
      Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
      Layout.maximumWidth: Style.spacing.dropdownWidth
      Layout.minimumWidth: visible ? Style.space(120) : 0
      spacing: Style.spacing.labelGap

      Text {
        text: Schema.FIELDS.double_hint.label
        color: Qt.darker(row.foreground, 1.4)
        font.family: row.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      TextField {
        id: hint
        Layout.fillWidth: true
        placeholderText: Schema.FIELDS.double_hint.placeholder
        text: row.gesture.double_hint || ""
        foreground: row.foreground
        accent: row.accent
        font.family: row.fontFamily
        font.pixelSize: Style.font.body
        onEditingFinished: {
          row.edited(row.rowIndex, "double_hint", hint.text)
          text = Qt.binding(function () { return row.gesture.double_hint || "" })
        }
      }
    }

    Item { Layout.fillWidth: true }
  }
}
