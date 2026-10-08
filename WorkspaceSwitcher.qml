import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "WorkspaceSwitcherLogic.js" as Logic

// Workspace Switcher: every workspace that has windows (plus the visible ones)
// as a card, in order of visit (current first), with its windows drawn at
// their real positions as previews.
//
// While the plugin is loaded it binds Alt + Tab to "next", Alt + Shift +
// Tab to "previous" and letting go of Alt to "commit": the first Tab opens
// the overview with the previous workspace selected, each further Tab moves to
// the next most recent, and letting go of Alt goes to the one selected, so a
// quick Alt + Tab flips between the last two. Super + Tab is never touched.
// The "toggle" and "close" globals are for anything else, such as touchpad
// gestures (see the README).
// The logic lives in WorkspaceSwitcherLogic.js.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string appId: "io.github.antoniowav.workspace-switcher"
  // Set when this instance binds the keys, so an older instance unloading
  // later doesn't undo a newer one's bindings.
  property string bindingOwner: ""
  property bool destroying: false

  property bool opened: false
  property bool queryWanted: false
  property var workspaces: []
  property int selectedIndex: 0
  // Opened by Alt + Tab: letting go of Alt goes to the selected workspace.
  property bool cycling: false
  // Tabs pressed while the overview is still opening.
  property int pendingSteps: 0
  // Super let go while the overview was still opening: switch without showing it.
  property bool commitPending: false
  // Workspace ids, most recently focused first; the cards follow this order.
  property var recent: []
  // The card under the pointer, once the pointer has moved since opening; the
  // highlight follows it and falls back to the keyboard's selection.
  property int hoveredIndex: -1
  property var pointerStart: null
  property bool pointerArmed: false
  readonly property int highlighted: Logic.highlightIndex(selectedIndex, hoveredIndex)
  property var targetScreen: null

  readonly property int gap: Style.space(22)
  readonly property int labelHeight: Style.space(28)
  readonly property real cardAspect: 16 / 9

  // Setting: wash the backdrop with a whisper of the theme's popup-border
  // color (the edge on bluetooth/sound flyouts), so the overview feels part
  // of the theme. Off = plain theme background. Light/dark follows the theme
  // either way: every color here resolves from the active theme at runtime.
  property bool accentTint: true
  readonly property color backdropColor: {
    var base = Color.background
    if (!root.accentTint) return Qt.alpha(base, 0.88)
    var b = Color.popups.border
    return Qt.rgba(base.r + (b.r - base.r) * 0.15, base.g + (b.g - base.g) * 0.15,
      base.b + (b.b - base.b) * 0.15, 0.88)
  }

  // Window previews composite over this bed. Transparent terminals stay
  // readable in light themes because the bed stays dark there; in dark themes
  // it is the theme surface itself. Opaque windows cover it fully.
  readonly property color previewBed: {
    var bg = Color.menu.background
    var luminance = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b
    return luminance > 0.5 ? "#101315" : bg
  }

  function focusedScreen() {
    var monitorName = Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""
    var screens = Quickshell.screens || []
    for (var i = 0; i < screens.length; ++i) {
      if (String(screens[i].name || "") === monitorName)
        return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  function open() {
    targetScreen = focusedScreen()
    queryWanted = true
    if (!stateQuery.running)
      stateQuery.running = true
  }

  function toggle() {
    if (opened) {
      close()
      return
    }
    cycling = false
    // A query that failed earlier may have left these behind; they would
    // turn this open into a silent workspace switch instead of the overview.
    commitPending = false
    pendingSteps = 0
    open()
  }

  // Alt + Tab (step 1) and Alt + Shift + Tab (step -1). The first one opens
  // the overview with the previous workspace (or, backwards, the least recent)
  // already selected, so a quick Alt + Tab flips between the last two.
  function cycle(step) {
    cycling = true
    if (opened) {
      selectedIndex = Logic.cycleSelection(highlighted, step, workspaces.length)
      hoveredIndex = -1
    } else if (queryWanted) {
      pendingSteps += step
    } else {
      pendingSteps = step
      open()
    }
  }

  // Alt was let go: go to the selected workspace. Letting go before the
  // overview has drawn still goes there, once it knows the workspaces.
  function commit() {
    if (!cycling) return
    if (!opened && queryWanted) {
      commitPending = true
      return
    }
    cycling = false
    var ws = Logic.commitTarget(opened, workspaces, highlighted)
    if (ws) {
      goToWorkspace(ws)
    } else {
      close()
    }
  }

  function close() {
    opened = false
    workspaces = []
    queryWanted = false
    cycling = false
    pendingSteps = 0
    commitPending = false
    hoveredIndex = -1
  }

  function pointerOver(index, position) {
    if (!pointerArmed) {
      if (!pointerStart) {
        pointerStart = { x: position.x, y: position.y }
        return
      }
      if (!Logic.pointerMoved(pointerStart, position.x, position.y, 4)) return
      pointerArmed = true
    }
    hoveredIndex = index
  }

  function pointerLeft(index) {
    if (hoveredIndex === index) hoveredIndex = -1
  }

  function dispatch(lua) {
    close()
    Qt.callLater(function() {
      Quickshell.execDetached(["hyprctl", "eval", "hl.dispatch(" + lua + ")"])
    })
  }

  function goToWorkspace(ws) {
    dispatch('hl.dsp.focus({ workspace = "' + ws.id + '" })')
  }

  function focusWindow(address) {
    dispatch('hl.dsp.focus({ window = "address:' + address + '" })')
  }

  function finishQuery(text) {
    if (!queryWanted) return
    queryWanted = false

    var state
    try {
      state = JSON.parse(String(text || "{}"))
    } catch (error) {
      console.warn("io.github.antoniowav.workspace-switcher: failed to parse hyprctl output:", error)
      close()
      return
    }

    var toplevelByAddress = ({})
    var toplevels = Hyprland.toplevels && Hyprland.toplevels.values ? Hyprland.toplevels.values : []
    for (var i = 0; i < toplevels.length; ++i) {
      var topAddress = Logic.normalizeAddress(toplevels[i].address)
      if (topAddress) toplevelByAddress[topAddress] = toplevels[i]
    }

    var entries = DesktopEntries.applications && DesktopEntries.applications.values
      ? DesktopEntries.applications.values : []
    var list = Logic.buildWorkspaces(state, Logic.appNameIndex(entries), function(address) {
      var top = toplevelByAddress[address]
      return top ? top.wayland : null
    })
    if (list.length === 0) {
      close()
      return
    }
    list = Logic.sortByRecent(list, recent)

    var selected = Logic.cycleSelection(Math.max(0, list.findIndex(function(ws) { return ws.focused })),
      pendingSteps, list.length)
    pendingSteps = 0
    if (commitPending) {
      var target = Logic.commitTarget(true, list, selected)
      close()
      if (target) goToWorkspace(target)
      return
    }

    workspaces = list
    selectedIndex = selected
    hoveredIndex = -1
    pointerStart = null
    pointerArmed = false
    opened = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function moveSelection(dx, dy) {
    selectedIndex = Logic.moveSelection(highlighted, dx, dy, grid.cols, workspaces.length)
    hoveredIndex = -1
  }

  function noteFocusedWorkspace() {
    recent = Logic.touchRecent(recent, Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : -1)
  }

  function applyBindings() {
    if (destroying) return
    bindingOwner = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
    Quickshell.execDetached(["hyprctl", "eval", Logic.bindingScript(appId, bindingOwner)])
  }

  function restoreBindings() {
    if (!bindingOwner) return
    Quickshell.execDetached(["hyprctl", "eval", Logic.restoreScript(bindingOwner)])
  }

  Component.onCompleted: {
    noteFocusedWorkspace()
    applyBindings()
  }

  Component.onDestruction: {
    destroying = true
    restoreBindings()
  }

  // A config reload rebuilds the bindings from the config files, dropping ours.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (event && event.name === "configreloaded") rebindTimer.restart()
    }
  }

  Timer {
    id: rebindTimer
    interval: 500
    onTriggered: root.applyBindings()
  }

  // Fires on workspace and monitor focus changes alike. A visit counts once
  // focus has stayed for a moment: going to a workspace on the other monitor
  // briefly focuses the one already showing there, which isn't a visit.
  Connections {
    target: Hyprland
    function onFocusedWorkspaceChanged() { visitTimer.restart() }
  }

  Timer {
    id: visitTimer
    interval: 200
    onTriggered: root.noteFocusedWorkspace()
  }

  Process {
    id: stateQuery
    command: ["sh", "-c",
      'printf \'{"monitors":%s,"workspaces":%s,"clients":%s}\' '
      + '"$(hyprctl monitors -j)" "$(hyprctl workspaces -j)" "$(hyprctl clients -j)"']
    running: false

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.finishQuery(text)
    }
  }

  GlobalShortcut {
    appid: "io.github.antoniowav.workspace-switcher"
    name: "toggle"
    description: "Open or close the workspace overview"
    onPressed: root.toggle()
  }

  GlobalShortcut {
    appid: "io.github.antoniowav.workspace-switcher"
    name: "next"
    description: "Open the workspace overview, or select the next workspace"
    onPressed: root.cycle(1)
  }

  GlobalShortcut {
    appid: "io.github.antoniowav.workspace-switcher"
    name: "previous"
    description: "Open the workspace overview, or select the previous workspace"
    onPressed: root.cycle(-1)
  }

  // Hyprland sends this one from a release binding, as a release.
  GlobalShortcut {
    appid: "io.github.antoniowav.workspace-switcher"
    name: "commit"
    description: "Go to the selected workspace if Super + Tab opened the overview"
    onPressed: root.commit()
    onReleased: root.commit()
  }

  GlobalShortcut {
    appid: "io.github.antoniowav.workspace-switcher"
    name: "close"
    description: "Close the workspace overview"
    onPressed: {
      if (root.opened) root.close()
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    onVisibleChanged: {
      if (visible) keyCatcher.forceActiveFocus()
    }
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"

    WlrLayershell.namespace: "workspace-switcher"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.backdropColor
    }

    // Clicking the backdrop closes the overview.
    MouseArea {
      anchors.fill: parent
      onClicked: root.close()
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true

      Keys.onPressed: function(event) {
        switch (event.key) {
        case Qt.Key_Escape: root.close(); break
        case Qt.Key_Left: root.moveSelection(-1, 0); break
        case Qt.Key_Right: root.moveSelection(1, 0); break
        case Qt.Key_Up: root.moveSelection(0, -1); break
        case Qt.Key_Down: root.moveSelection(0, 1); break
        case Qt.Key_Return:
        case Qt.Key_Enter:
          if (root.workspaces[root.highlighted]) root.goToWorkspace(root.workspaces[root.highlighted])
          break
        default: return
        }
        event.accepted = true
      }
    }

    Item {
      id: area
      anchors.fill: parent
      anchors.margins: Style.space(48)

      readonly property var fit: Logic.layoutFor(root.workspaces.length, width, height, root.gap, root.labelHeight, root.cardAspect)

      Grid {
        id: grid
        readonly property int cols: area.fit.cols
        anchors.centerIn: parent
        columns: cols
        spacing: root.gap

        Repeater {
          model: root.workspaces

          delegate: Item {
            id: card
            required property int index
            required property var modelData

            readonly property bool selected: index === root.highlighted
            width: area.fit.cardW
            height: width / root.cardAspect + root.labelHeight
            // The other cards dim slightly, so the highlighted one stands out.
            opacity: selected ? 1 : 0.7

            HoverHandler {
              onPointChanged: if (hovered) root.pointerOver(card.index, point.scenePosition)
              onHoveredChanged: if (!hovered) root.pointerLeft(card.index)
            }

            // "Current" marks the workspace you are on, whatever is highlighted.
            // It follows the workspace's name, so it can't be read as the
            // neighbouring card's.
            Rectangle {
              id: currentTag
              visible: card.modelData.focused
              anchors { left: label.right; leftMargin: Style.space(8); verticalCenter: label.verticalCenter }
              width: currentText.implicitWidth + Style.space(16)
              height: currentText.implicitHeight + Style.space(6)
              radius: height / 2
              color: Color.accent

              Text {
                id: currentText
                textFormat: Text.PlainText
                anchors.centerIn: parent
                text: "Current"
                color: Color.background
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.caption
                font.bold: true
              }
            }

            Text {
              id: label
              textFormat: Text.PlainText
              anchors { left: parent.left; top: parent.top }
              width: Math.min(implicitWidth, parent.width - (currentTag.visible ? currentTag.width + Style.space(8) : 0))
              height: root.labelHeight
              verticalAlignment: Text.AlignVCenter
              elide: Text.ElideRight
              text: card.modelData.name + "  ·  " + (card.modelData.windows.length === 0
                ? "empty"
                : card.modelData.windows
                    .map(function(w) { return w.label })
                    .filter(function(app, i, apps) { return apps.indexOf(app) === i })
                    .join(", "))
              color: card.selected ? Color.accent : Color.menu.text
              font.family: Style.font.menuFamily
              font.pixelSize: Style.font.body
              font.bold: card.modelData.focused
            }

            Rectangle {
              id: screenFrame
              anchors { left: parent.left; right: parent.right; top: label.bottom; bottom: parent.bottom }
              radius: Style.cornerRadius
              color: Color.menu.background
              border.width: card.selected ? Math.max(3, Style.normalBorderWidth * 2) : Math.max(1, Style.normalBorderWidth)
              border.color: card.selected ? Color.accent : Color.menu.border
              clip: true

              // Empty space in the card goes to the workspace.
              MouseArea {
                anchors.fill: parent
                onClicked: root.goToWorkspace(card.modelData)
              }

              // The workspace's monitor, letterboxed into the card.
              Item {
                id: screenArea
                readonly property real monAspect: card.modelData.monitor.w / card.modelData.monitor.h
                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height * monAspect)
                height: width / monAspect

                Repeater {
                  model: card.modelData.windows

                  delegate: Rectangle {
                    id: win
                    required property var modelData

                    x: modelData.x * screenArea.width
                    y: modelData.y * screenArea.height
                    width: Math.max(8, modelData.w * screenArea.width)
                    height: Math.max(8, modelData.h * screenArea.height)
                    radius: Math.max(2, Style.cornerRadius / 2)
                    color: Qt.alpha(Color.menu.text, 0.08)
                    border.width: 1
                    border.color: winMouse.containsMouse ? Color.accent : Qt.alpha(Color.menu.text, 0.18)
                    clip: true

                    Text {
                      textFormat: Text.PlainText
                      anchors.centerIn: parent
                      width: parent.width - Style.space(8)
                      text: win.modelData.app
                      color: Color.menu.text
                      opacity: preview.hasContent ? 0 : 0.6
                      horizontalAlignment: Text.AlignHCenter
                      elide: Text.ElideRight
                      font.family: Style.font.menuFamily
                      font.pixelSize: Style.font.caption
                    }

                    // Opaque bed directly under the live preview, so transparent
                    // windows (terminals with a see-through background) read
                    // as solid tiles instead of ghosts. Hidden without content,
                    // where the app-name placeholder shows instead.
                    Rectangle {
                      anchors.fill: preview
                      visible: preview.hasContent
                      color: root.previewBed
                    }

                    ScreencopyView {
                      id: preview
                      anchors.fill: parent
                      anchors.margins: 1
                      captureSource: root.opened && win.modelData.wayland ? win.modelData.wayland : null
                      paintCursor: false
                      // One frame per open keeps the overview cheap.
                      live: false
                      constraintSize: Qt.size(Math.max(1, width), Math.max(1, height))
                      opacity: hasContent ? 1 : 0
                    }

                    // App name on every window, so tiled windows can be told apart.
                    Rectangle {
                      visible: preview.hasContent && win.width > Style.space(40)
                      anchors { left: parent.left; bottom: parent.bottom; margins: Style.space(4) }
                      width: Math.min(nameText.implicitWidth + Style.space(12), parent.width - Style.space(8))
                      height: nameText.implicitHeight + Style.space(4)
                      radius: height / 2
                      color: Qt.alpha(Color.menu.background, 0.85)

                      Text {
                        id: nameText
                        textFormat: Text.PlainText
                        anchors.centerIn: parent
                        width: parent.width - Style.space(12)
                        horizontalAlignment: Text.AlignHCenter
                        text: win.modelData.label
                        color: Color.menu.text
                        elide: Text.ElideRight
                        font.family: Style.font.menuFamily
                        font.pixelSize: Style.font.caption
                      }
                    }

                    MouseArea {
                      id: winMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      onClicked: root.focusWindow(win.modelData.address)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
