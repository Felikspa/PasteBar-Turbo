export const APP_HOTKEY_DEFAULTS = {
  navHistory: ['alt+b', 'ctrl+b', 'meta+b'],
  navMenu: ['alt+m', 'ctrl+m', 'meta+m'],
  lockApp: ['alt+l', 'ctrl+l', 'meta+l'],
  swapPanels: ['ctrl+alt+p', 'ctrl+meta+p'],
  mediaPlayPause: ['alt+p', 'ctrl+p', 'meta+p'],
  mediaNext: ['alt+]', 'ctrl+]', 'meta+]'],
  mediaPrev: ['alt+[', 'ctrl+[', 'meta+['],
  settingsCollections: ['alt+c'],
  settingsHistory: ['alt+h'],
  settingsPreferences: ['alt+u'],
  closeApp: ['ctrl+q', 'meta+q'],
  toggleSplitView: ['alt+n', 'ctrl+n', 'meta+n'],
  showQuickPaste: ['alt+p', 'ctrl+p', 'meta+p'],
  hideWindow: ['ctrl+w'],
  quickPasteSearch: ['ctrl+f', 'meta+f', 'ctrl+k', 'meta+k', '/'],
}

export type AppHotkeyId = keyof typeof APP_HOTKEY_DEFAULTS
export type AppHotkeys = Partial<Record<AppHotkeyId, string>>

export const APP_HOTKEY_LABELS: Record<AppHotkeyId, string> = {
  navHistory: 'Go to Clipboard History',
  navMenu: 'Go to Paste Menu',
  lockApp: 'Lock App',
  swapPanels: 'Swap Panels',
  mediaPlayPause: 'Play or Pause Media',
  mediaNext: 'Next Media',
  mediaPrev: 'Previous Media',
  settingsCollections: 'Open Collections Settings',
  settingsHistory: 'Open History Settings',
  settingsPreferences: 'Open Preferences',
  closeApp: 'Close App',
  toggleSplitView: 'Toggle Split View',
  showQuickPaste: 'Show Quick Paste Window',
  hideWindow: 'Hide Window',
  quickPasteSearch: 'Quick Paste Search',
}

export const getAppHotkey = (appHotkeys: AppHotkeys, id: AppHotkeyId) => {
  if (Object.prototype.hasOwnProperty.call(appHotkeys, id)) {
    const hotkey = appHotkeys[id]
    return hotkey ? hotkey : []
  }

  return APP_HOTKEY_DEFAULTS[id]
}

const HOTKEY_PART_LABELS: Record<string, string> = {
  alt: 'Alt',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Meta',
  shift: 'Shift',
  space: 'Space',
  esc: 'Esc',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
}

export const formatHotkey = (hotkey: string) =>
  hotkey
    .split('+')
    .map(part => {
      const trimmed = part.trim()
      const lower = trimmed.toLowerCase()

      if (HOTKEY_PART_LABELS[lower]) {
        return HOTKEY_PART_LABELS[lower]
      }

      if (trimmed.length === 1) {
        return trimmed.toUpperCase()
      }

      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    })
    .join('+')

export const formatHotkeyList = (hotkeys: string | string[]) =>
  (Array.isArray(hotkeys) ? hotkeys : hotkeys.split(','))
    .map(hotkey => formatHotkey(hotkey.trim()))
    .filter(Boolean)
    .join(', ')
