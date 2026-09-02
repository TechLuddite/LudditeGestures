import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Schema.js" as Schema

// One editable gesture. Contextual fields appear only for the actions that use
// them, so a row never shows a control Hyprland would ignore.
RowLayout {
  id: row

  property var gesture: ({})
  property int index: 0
  property color foreground: "white"
  property color accent: "white"
  property string fontFamily: ""

  signal edited(int index, string field, var value)
  signal removed(int index)

  readonly property var fields: Schema.actionFields(gesture.action || "")

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
    onModified: row.edited(row.index, "fingers", fingers.value)
  }

  Dropdown {
    id: direction
    Layout.fillWidth: true
    Layout.preferredWidth: Style.spacing.dropdownWidth
    Layout.maximumWidth: Style.spacing.dropdownWidth
    Layout.minimumWidth: Style.space(130)
    label: "Gesture"
    options: Schema.DIRECTIONS
    value: row.gesture.direction || ""
    foreground: row.foreground
    accent: row.accent
    fontFamily: row.fontFamily
    onChanged: function (v) { row.edited(row.index, "direction", v) }
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
    onChanged: function (v) { row.edited(row.index, "action", v) }
  }

  Dropdown {
    id: mode
    visible: row.fields.indexOf("mode") !== -1
    Layout.fillWidth: visible
    Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
    Layout.maximumWidth: Style.spacing.dropdownWidth
    Layout.minimumWidth: visible ? Style.space(120) : 0
    label: "Mode"
    options: Schema.MODES
    value: row.gesture.mode || ""
    foreground: row.foreground
    accent: row.accent
    fontFamily: row.fontFamily
    onChanged: function (v) { row.edited(row.index, "mode", v) }
  }

  TextField {
    id: workspaceName
    visible: row.fields.indexOf("workspace_name") !== -1
    Layout.fillWidth: visible
    Layout.preferredWidth: visible ? Style.spacing.dropdownWidth : 0
    Layout.maximumWidth: Style.spacing.dropdownWidth
    Layout.minimumWidth: visible ? Style.space(120) : 0
    placeholderText: "Workspace name"
    text: row.gesture.workspace_name || ""
    foreground: row.foreground
    accent: row.accent
    font.family: row.fontFamily
    font.pixelSize: Style.font.body
    onEditingFinished: row.edited(row.index, "workspace_name", workspaceName.text)
  }

  Item { Layout.fillWidth: true }

  PanelActionButton {
    iconText: "󰅖"
    tooltipText: "Remove this gesture"
    foreground: row.foreground
    fontFamily: row.fontFamily
    onClicked: row.removed(row.index)
  }
}
