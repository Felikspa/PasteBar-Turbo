import { useEffect, useState } from 'react'
import {
  APP_HOTKEY_DEFAULTS,
  APP_HOTKEY_LABELS,
  AppHotkeyId,
  formatHotkey,
  formatHotkeyList,
} from '~/lib/app-hotkeys'
import { settingsStoreAtom } from '~/store'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'

import Spacer from '~/components/atoms/spacer'
import SimpleBar from '~/components/libs/simplebar-react'
import InputField from '~/components/molecules/input'
import { Box, Button, Card, CardContent, CardHeader, CardTitle, Flex, Text } from '~/components/ui'

function getRecordedHotkey(event: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>) {
  const { ctrlKey, shiftKey, altKey, metaKey, key } = event
  const pressedKeys: string[] = []

  if (ctrlKey) {
    pressedKeys.push('Ctrl')
  }
  if (shiftKey) {
    pressedKeys.push('Shift')
  }
  if (altKey) {
    pressedKeys.push('Alt')
  }
  if (metaKey) {
    pressedKeys.push('Cmd')
  }

  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    if (key === ' ') {
      pressedKeys.push('Space')
    } else {
      pressedKeys.push(formatHotkey(key))
    }
  }

  return pressedKeys.join('+')
}

export default function HotkeysSettings() {
  const { t } = useTranslation()
  const {
    hotKeysShowHideMainAppWindow,
    hotKeysShowHideQuickPasteWindow,
    appHotkeys,
    setHotKeysShowHideMainAppWindow,
    setHotKeysShowHideQuickPasteWindow,
    setAppHotkey,
  } = useAtomValue(settingsStoreAtom)

  const [mainAppHotkey, setMainAppHotkey] = useState('')
  const [quickPasteHotkey, setQuickPasteHotkey] = useState('')
  const [currentKeyPreview, setCurrentKeyPreview] = useState('')
  const [appHotkeyDrafts, setAppHotkeyDrafts] = useState<Record<string, string>>({})
  const [isEditingMainApp, setIsEditingMainApp] = useState(false)
  const [isEditingQuickPaste, setIsEditingQuickPaste] = useState(false)
  const [editingAppHotkeyId, setEditingAppHotkeyId] = useState<AppHotkeyId | null>(null)

  useEffect(() => {
    setMainAppHotkey(formatHotkeyList(hotKeysShowHideMainAppWindow || ''))
    setQuickPasteHotkey(formatHotkeyList(hotKeysShowHideQuickPasteWindow || ''))
  }, [hotKeysShowHideMainAppWindow, hotKeysShowHideQuickPasteWindow])

  const handleGlobalHotkeyKeyDown = (
    event: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>,
    setter: (value: string) => void,
    save: (value: string) => void,
    close: () => void,
    currentValue: string
  ) => {
    event.preventDefault()

    if (event.key === 'Escape' || event.key === 'Esc') {
      close()
      setCurrentKeyPreview('')
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      setter('')
      setCurrentKeyPreview('')
      return
    }

    if (event.key === 'Enter') {
      save(currentValue)
      close()
      setCurrentKeyPreview('')
      return
    }

    const hotkey = getRecordedHotkey(event)
    setCurrentKeyPreview(hotkey)

    if (hotkey.includes('+')) {
      setter(hotkey)
    }
  }

  const getAppHotkeyValue = (id: AppHotkeyId) => {
    if (Object.prototype.hasOwnProperty.call(appHotkeys, id)) {
      return formatHotkeyList(appHotkeys[id] ?? '')
    }

    return formatHotkeyList(APP_HOTKEY_DEFAULTS[id])
  }

  const handleAppHotkeyKeyDown = (
    event: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>,
    id: AppHotkeyId
  ) => {
    event.preventDefault()

    if (event.key === 'Escape' || event.key === 'Esc') {
      setAppHotkeyDrafts(prev => ({
        ...prev,
        [id]: getAppHotkeyValue(id),
      }))
      setEditingAppHotkeyId(null)
      setCurrentKeyPreview('')
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      setAppHotkeyDrafts(prev => ({
        ...prev,
        [id]: '',
      }))
      setCurrentKeyPreview('')
      return
    }

    if (event.key === 'Enter') {
      setAppHotkey(id, appHotkeyDrafts[id] ?? getAppHotkeyValue(id))
      setEditingAppHotkeyId(null)
      setCurrentKeyPreview('')
      return
    }

    const hotkey = getRecordedHotkey(event)
    setCurrentKeyPreview(hotkey)
    setAppHotkeyDrafts(prev => ({
      ...prev,
      [id]: hotkey,
    }))
  }

  const handleKeyUp = () => {
    setCurrentKeyPreview('')
  }

  return (
    <Box className="animate-in fade-in h-full">
      <SimpleBar className="code-filter h-[calc(100vh-70px)]">
        <Box className="p-6">
          <Box className="max-w-xl">
            <Card>
              <CardHeader className="flex flex-col items-start justify-between space-y-0 pb-1">
                <CardTitle className="animate-in fade-in text-md font-medium w-full mb-3">
                  {t('Global System OS Hotkeys', { ns: 'settings2' })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Text className="text-sm text-muted-foreground mb-4">
                  {t(
                    'Set system OS hotkeys to show/hide the main app window and quick paste window. Supports up to 3-key combinations.',
                    { ns: 'settings2' }
                  )}
                </Text>
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <Text className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                    {t('How to set hotkeys:', { ns: 'settings2' })}
                  </Text>
                  <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                    <li>{t('Click Set/Change button to start recording', { ns: 'settings2' })}</li>
                    <li>
                      {t('Press your desired key combination (e.g., Ctrl+Shift+V)', {
                        ns: 'settings2',
                      })}
                    </li>
                    <li>{t('Press Enter to confirm or Escape to cancel', { ns: 'settings2' })}</li>
                    <li>{t('Press Backspace/Delete to clear the hotkey', { ns: 'settings2' })}</li>
                  </ul>
                </div>

                <Box className="mb-4">
                  <InputField
                    label={t('Show/Hide Main App Window', { ns: 'settings2' })}
                    value={isEditingMainApp ? currentKeyPreview || mainAppHotkey : mainAppHotkey}
                    autoFocus={isEditingMainApp}
                    disabled={!isEditingMainApp}
                    onKeyDown={e =>
                      isEditingMainApp &&
                      handleGlobalHotkeyKeyDown(
                        e,
                        setMainAppHotkey,
                        setHotKeysShowHideMainAppWindow,
                        () => setIsEditingMainApp(false),
                        mainAppHotkey
                      )
                    }
                    onKeyUp={handleKeyUp}
                    readOnly={!isEditingMainApp}
                    placeholder={
                      isEditingMainApp
                        ? t('Press your key combination...', { ns: 'settings2' })
                        : mainAppHotkey || t('No keys set', { ns: 'settings2' })
                    }
                    className={isEditingMainApp ? 'border-blue-300 dark:border-blue-600' : ''}
                  />
                  <Flex className="mt-2 gap-2 justify-start">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (isEditingMainApp) {
                          setHotKeysShowHideMainAppWindow(mainAppHotkey)
                          setIsEditingMainApp(false)
                        } else {
                          setIsEditingQuickPaste(false)
                          setIsEditingMainApp(true)
                        }
                      }}
                    >
                      {isEditingMainApp
                        ? t('Done', { ns: 'common' })
                        : !mainAppHotkey
                          ? t('Set', { ns: 'settings2' })
                          : t('Change', { ns: 'settings2' })}
                    </Button>
                    {isEditingMainApp && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setMainAppHotkey(formatHotkeyList(hotKeysShowHideMainAppWindow || ''))
                          setIsEditingMainApp(false)
                        }}
                      >
                        {t('Cancel', { ns: 'common' })}
                      </Button>
                    )}
                  </Flex>
                </Box>

                <Box>
                  <InputField
                    label={t('Show/Hide Quick Paste Window', { ns: 'settings2' })}
                    value={
                      isEditingQuickPaste
                        ? currentKeyPreview || quickPasteHotkey
                        : quickPasteHotkey
                    }
                    disabled={!isEditingQuickPaste}
                    autoFocus={isEditingQuickPaste}
                    onKeyDown={e =>
                      isEditingQuickPaste &&
                      handleGlobalHotkeyKeyDown(
                        e,
                        setQuickPasteHotkey,
                        setHotKeysShowHideQuickPasteWindow,
                        () => setIsEditingQuickPaste(false),
                        quickPasteHotkey
                      )
                    }
                    onKeyUp={handleKeyUp}
                    readOnly={!isEditingQuickPaste}
                    placeholder={
                      isEditingQuickPaste
                        ? t('Press your key combination...', { ns: 'settings2' })
                        : quickPasteHotkey || t('No keys set', { ns: 'settings2' })
                    }
                    className={isEditingQuickPaste ? 'border-blue-300 dark:border-blue-600' : ''}
                  />
                  <Flex className="mt-2 gap-2 justify-start">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (isEditingQuickPaste) {
                          setHotKeysShowHideQuickPasteWindow(quickPasteHotkey)
                          setIsEditingQuickPaste(false)
                        } else {
                          setIsEditingMainApp(false)
                          setIsEditingQuickPaste(true)
                        }
                      }}
                    >
                      {isEditingQuickPaste
                        ? t('Done', { ns: 'common' })
                        : !quickPasteHotkey
                          ? t('Set', { ns: 'settings2' })
                          : t('Change', { ns: 'settings2' })}
                    </Button>
                    {isEditingQuickPaste && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setQuickPasteHotkey(formatHotkeyList(hotKeysShowHideQuickPasteWindow || ''))
                          setIsEditingQuickPaste(false)
                        }}
                      >
                        {t('Cancel', { ns: 'common' })}
                      </Button>
                    )}
                  </Flex>
                </Box>
              </CardContent>
            </Card>
          </Box>

          <Spacer h={4} />

          <Box className="max-w-xl">
            <Card>
              <CardHeader className="flex flex-col items-start justify-between space-y-0 pb-1">
                <CardTitle className="animate-in fade-in text-md font-medium w-full mb-3">
                  {t('Application Hotkeys', { ns: 'settings2' })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Text className="text-sm text-muted-foreground mb-4">
                  {t(
                    'Customize app window shortcuts. Press Backspace or Delete while recording to disable an action.',
                    { ns: 'settings2' }
                  )}
                </Text>
                <div className="space-y-3">
                  {(Object.keys(APP_HOTKEY_LABELS) as AppHotkeyId[]).map(id => {
                    const isEditing = editingAppHotkeyId === id
                    const value = isEditing
                      ? currentKeyPreview || appHotkeyDrafts[id] || ''
                      : getAppHotkeyValue(id)

                    return (
                      <div
                        key={id}
                        className="flex items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700"
                      >
                        <div className="relative flex-1">
                          <InputField
                            label={t(APP_HOTKEY_LABELS[id], { ns: 'settings2' })}
                            value={value}
                            disabled={!isEditing}
                            autoFocus={isEditing}
                            onKeyDown={e => isEditing && handleAppHotkeyKeyDown(e, id)}
                            onKeyUp={handleKeyUp}
                            readOnly={!isEditing}
                            placeholder={
                              isEditing
                                ? t('Press your key combination...', { ns: 'settings2' })
                                : t('No keys set', { ns: 'settings2' })
                            }
                            className={isEditing ? 'border-blue-300 dark:border-blue-600' : ''}
                          />
                        </div>
                        <Flex className="gap-2 pb-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (isEditing) {
                                setAppHotkey(id, appHotkeyDrafts[id] ?? '')
                                setEditingAppHotkeyId(null)
                                setCurrentKeyPreview('')
                              } else {
                                setAppHotkeyDrafts(prev => ({
                                  ...prev,
                                  [id]: getAppHotkeyValue(id),
                                }))
                                setEditingAppHotkeyId(id)
                              }
                            }}
                          >
                            {isEditing ? t('Done', { ns: 'common' }) : t('Change', { ns: 'settings2' })}
                          </Button>
                          {isEditing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setAppHotkeyDrafts(prev => ({
                                  ...prev,
                                  [id]: getAppHotkeyValue(id),
                                }))
                                setEditingAppHotkeyId(null)
                                setCurrentKeyPreview('')
                              }}
                            >
                              {t('Cancel', { ns: 'common' })}
                            </Button>
                          )}
                        </Flex>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </Box>
        </Box>
      </SimpleBar>
    </Box>
  )
}
