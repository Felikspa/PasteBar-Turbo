import { useEffect } from 'react'
import { convertFileSrc } from '@tauri-apps/api/tauri'
import i18n from '~/locales'
import { LANGUAGES } from '~/locales/languges'
import {
  fontSizeIncrements,
  settingsStoreAtom,
  themeStoreAtom,
  uiStoreAtom,
} from '~/store'
import { useAtomValue } from 'jotai'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import AutoSize from 'react-virtualized-auto-sizer'

import Spacer from '~/components/atoms/spacer'
import { Icons } from '~/components/icons'
import SimpleBar from '~/components/libs/simplebar-react'
import InputField from '~/components/molecules/input'
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Flex,
  Switch,
  Text,
} from '~/components/ui'

export default function ThemeSettings() {
  const { t } = useTranslation()
  const {
    isShowCollectionNameOnNavBar,
    setIsShowCollectionNameOnNavBar,
    isHideCollectionsOnNavBar,
    setIsHideCollectionsOnNavBar,
    isShowNavBarItemsOnHoverOnly,
    setIsShowNavBarItemsOnHoverOnly,
    isShowDisabledCollectionsOnNavBarMenu,
    setIsShowDisabledCollectionsOnNavBarMenu,
    isHistoryPanelVisibleOnly,
    setIsHistoryPanelVisibleOnly,
    isSavedClipsPanelVisibleOnly,
    setShowBothPanels,
    setIsSavedClipsPanelVisibleOnly,
    isSimplifiedLayout,
    setIsSimplifiedLayout,
    quickPasteAcrylicOpacity,
    setQuickPasteAcrylicOpacity,
    quickPasteAcrylicColorDepth,
    setQuickPasteAcrylicColorDepth,
    quickPasteMaskStrength,
    setQuickPasteMaskStrength,
    quickPasteFontSize,
    setQuickPasteFontSize,
    quickPasteHighlightColor,
    setQuickPasteHighlightColor,
  } = useAtomValue(settingsStoreAtom)

  const { setFontSize, fontSize, setIsSwapPanels, isSwapPanels, returnRoute, isWindows } =
    useAtomValue(uiStoreAtom)
  const { setTheme, theme } = useTheme()
  const { mode, setMode } = useAtomValue(themeStoreAtom)
  const isSinglePanelView = isHistoryPanelVisibleOnly || isSavedClipsPanelVisibleOnly
  const materialPreviewDesktopUrl = convertFileSrc(
    'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg'
  )
  const materialPreviewTintChannel =
    249 - Math.round(((249 - 17) * quickPasteAcrylicColorDepth) / 100)

  useEffect(() => {
    if (theme !== mode) {
      setMode(theme)
    }
  }, [theme, mode, setMode])

  return (
    <AutoSize disableWidth>
      {({ height }) =>
        height && (
          <Box className="p-4 py-6 select-none min-w-[320px]">
            <Box className="text-xl my-2 mx-2 flex items-center justify-between">
              <Text className="light">{t('Theme Settings', { ns: 'settings2' })}</Text>
              <Link to={returnRoute} replace>
                <Button
                  variant="ghost"
                  className="text-sm bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                  size="sm"
                >
                  {t('Back', { ns: 'common' })}
                </Button>
              </Link>
            </Box>
            <Spacer h={3} />

            <SimpleBar style={{ maxHeight: height - 85 }} autoHide>
              <Box className="animate-in fade-in max-w-xl">
                <Card>
                  <CardHeader className="flex flex-col items-start justify-between space-y-0 pb-1">
                    <CardTitle className="animate-in fade-in text-md font-medium w-full mb-3">
                      {t('Application UI Fonts Scale', { ns: 'settings' })}
                      <Text className="text-sm text-muted-foreground mt-2">
                        {t('Change the application user interface font size scale', {
                          ns: 'settings',
                        })}
                      </Text>
                    </CardTitle>
                    <Flex className="gap-3 flex-wrap items-start justify-start">
                      {fontSizeIncrements.map((size, index) => (
                        <Button
                          key={index}
                          variant="ghost"
                          onClick={() => setFontSize(size)}
                          className={`text-sm font-normal bg-slate-50 dark:bg-slate-950 ${
                            fontSize === size
                              ? 'bg-slate-300 font-semibold dark:bg-slate-600 text-dark dark:text-slate-200 hover:dark:bg-slate-600 hover:bg-slate-300'
                              : ''
                          } dark:text-slate-200 px-2 !py-0.5`}
                        >
                          {size}
                        </Button>
                      ))}
                    </Flex>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={fontSize === '100%'}
                      onClick={() => setFontSize('100%')}
                      className="text-sm bg-slate-200 dark:bg-slate-700 dark:text-slate-200 mt-1"
                    >
                      {t('Reset', { ns: 'common' })}
                    </Button>
                  </CardContent>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start justify-between space-y-0 pb-1 mb-4">
                    <CardTitle className="animate-in fade-in text-md font-medium w-full mb-3">
                      {t('Application UI Color Theme', { ns: 'settings' })}
                      <Text className="text-sm text-muted-foreground mt-2">
                        {t('Change the application user interface color theme', {
                          ns: 'settings',
                        })}
                      </Text>
                    </CardTitle>
                    <Flex className="gap-3 flex-wrap items-start justify-start">
                      <Button
                        variant="ghost"
                        onClick={() => setTheme('light')}
                        className={`text-sm border-0 font-normal bg-slate-50 dark:bg-slate-950 ${
                          theme === 'light'
                            ? 'bg-slate-300 font-semibold dark:bg-slate-600 text-dark dark:text-slate-200 hover:dark:bg-slate-600 hover:bg-slate-300'
                            : ''
                        } dark:text-slate-200 px-3 !py-0.5`}
                      >
                        <Icons.sun className="mr-2" size={18} />
                        <span>{t('Theme:::Light', { ns: 'navbar' })}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setTheme('dark')}
                        className={`text-sm border-0 font-normal bg-slate-50 dark:bg-slate-950 ${
                          theme === 'dark'
                            ? 'bg-slate-300 font-semibold dark:bg-slate-600 text-dark dark:text-slate-200 hover:dark:bg-slate-600 hover:bg-slate-300'
                            : ''
                        } dark:text-slate-200 px-3 !py-0.5`}
                      >
                        <Icons.moon className="mr-2" size={17} />
                        <span>{t('Theme:::Dark', { ns: 'navbar' })}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setTheme('system')}
                        className={`text-sm border-0 font-normal bg-slate-50 dark:bg-slate-950 ${
                          theme === 'system'
                            ? 'bg-slate-300 font-semibold dark:bg-slate-600 text-dark dark:text-slate-200 hover:dark:bg-slate-600 hover:bg-slate-300'
                            : ''
                        } dark:text-slate-200 px-3 !py-0.5`}
                      >
                        <span className="tems-end flex w-[1.5rem] ">
                          <Icons.sunmoon className="mr-2" width={14} height={14} />
                        </span>
                        <span>{t('Theme:::System', { ns: 'navbar' })}</span>
                      </Button>
                    </Flex>
                  </CardHeader>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start justify-between space-y-0 pb-1 mb-4">
                    <CardTitle className="animate-in fade-in text-md font-medium w-full mb-3">
                      {t('Application UI Language', { ns: 'settings' })}
                      <Text className="text-sm text-muted-foreground mt-2">
                        {t('Change the application user interface language', {
                          ns: 'settings',
                        })}
                      </Text>
                    </CardTitle>
                    <Flex className="gap-3 flex-wrap items-start justify-start">
                      {LANGUAGES.map(({ code, name, flag }) => (
                        <Button
                          key={code}
                          variant="ghost"
                          onClick={() => i18n.changeLanguage(code)}
                          className={`text-sm font-normal bg-slate-50 dark:bg-slate-950 ${
                            i18n.language === code
                              ? 'bg-slate-300 font-semibold dark:bg-slate-600 text-dark dark:text-slate-200 hover:dark:bg-slate-600 hover:bg-slate-300'
                              : ''
                          } dark:text-slate-200 px-3 !py-0.5`}
                        >
                          <span className="flags mr-3">{flag}</span> {name}
                        </Button>
                      ))}
                    </Flex>
                  </CardHeader>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="animate-in fade-in text-md font-medium">
                      {t('Quick Paste Appearance', { ns: 'settings2' })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Text className="text-[15px] font-semibold">
                            {t('Quick Paste Font Size', { ns: 'settings2' })}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {t('Adjust Quick Paste text size.', { ns: 'settings2' })}
                          </Text>
                        </div>
                        <InputField
                          className="text-md !w-20"
                          type="number"
                          step="1"
                          min={12}
                          max={24}
                          small
                          value={quickPasteFontSize}
                          onBlur={() => setQuickPasteFontSize(quickPasteFontSize)}
                          onChange={e => {
                            const value = e.target.value
                            setQuickPasteFontSize(value === '' ? 16 : parseInt(value, 10))
                          }}
                        />
                      </div>
                      <input
                        aria-label={t('Quick Paste Font Size', { ns: 'settings2' })}
                        className="w-full accent-sky-600"
                        type="range"
                        min={12}
                        max={24}
                        step={1}
                        value={quickPasteFontSize}
                        onChange={e =>
                          setQuickPasteFontSize(parseInt(e.target.value, 10))
                        }
                      />

                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Text className="text-[15px] font-semibold">
                            {t('Quick Paste Highlight Color', { ns: 'settings2' })}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {t('Set the border color for pressed Quick Paste items.', {
                              ns: 'settings2',
                            })}
                          </Text>
                        </div>
                        <div className="flex w-44 items-center gap-2">
                          <div
                            aria-hidden="true"
                            className="h-8 w-8 shrink-0 rounded border border-slate-300 dark:border-slate-700"
                            style={{ backgroundColor: quickPasteHighlightColor }}
                          />
                          <InputField
                            className="text-md"
                            small
                            value={quickPasteHighlightColor}
                            onChange={e => setQuickPasteHighlightColor(e.target.value)}
                          />
                        </div>
                      </div>

                      {isWindows && (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <Text className="text-[15px] font-semibold">
                                {t('Acrylic opacity', { ns: 'settings2' })}
                              </Text>
                              <Text className="text-xs text-muted-foreground">
                                {t(
                                  'Adjust the transparency of the Quick Paste acrylic surface.',
                                  { ns: 'settings2' }
                                )}
                              </Text>
                            </div>
                            <InputField
                              className="text-md !w-20"
                              type="number"
                              step="1"
                              min={25}
                              max={100}
                              small
                              value={quickPasteAcrylicOpacity}
                              onBlur={() =>
                                setQuickPasteAcrylicOpacity(quickPasteAcrylicOpacity)
                              }
                              onChange={e => {
                                const value = e.target.value
                                setQuickPasteAcrylicOpacity(
                                  value === '' ? 86 : parseInt(value, 10)
                                )
                              }}
                            />
                          </div>
                          <input
                            aria-label={t('Acrylic opacity', { ns: 'settings2' })}
                            className="w-full accent-sky-600"
                            type="range"
                            min={25}
                            max={100}
                            step={1}
                            value={quickPasteAcrylicOpacity}
                            onChange={e =>
                              setQuickPasteAcrylicOpacity(parseInt(e.target.value, 10))
                            }
                          />
                        </>
                      )}
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Text className="text-[15px] font-semibold">
                            {t('Acrylic color depth', { ns: 'settings2' })}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {t('Adjust the tint depth of the Quick Paste acrylic.', {
                              ns: 'settings2',
                            })}
                          </Text>
                        </div>
                        <InputField
                          className="text-md !w-20"
                          type="number"
                          step="1"
                          min={0}
                          max={100}
                          small
                          value={quickPasteAcrylicColorDepth}
                          onBlur={() =>
                            setQuickPasteAcrylicColorDepth(quickPasteAcrylicColorDepth)
                          }
                          onChange={e => {
                            const value = e.target.value
                            setQuickPasteAcrylicColorDepth(
                              value === '' ? 100 : parseInt(value, 10)
                            )
                          }}
                        />
                      </div>
                      <input
                        aria-label={t('Acrylic color depth', { ns: 'settings2' })}
                        className="w-full accent-sky-600"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={quickPasteAcrylicColorDepth}
                        onChange={e =>
                          setQuickPasteAcrylicColorDepth(parseInt(e.target.value, 10))
                        }
                      />
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Text className="text-[15px] font-semibold">
                            {t('Mask strength', { ns: 'settings2' })}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {t('Adjust the page overlay strength behind the list.', {
                              ns: 'settings2',
                            })}
                          </Text>
                        </div>
                        <InputField
                          className="text-md !w-20"
                          type="number"
                          step="1"
                          min={0}
                          max={100}
                          small
                          value={quickPasteMaskStrength}
                          onBlur={() => setQuickPasteMaskStrength(quickPasteMaskStrength)}
                          onChange={e => {
                            const value = e.target.value
                            setQuickPasteMaskStrength(value === '' ? 72 : parseInt(value, 10))
                          }}
                        />
                      </div>
                      <input
                        aria-label={t('Mask strength', { ns: 'settings2' })}
                        className="w-full accent-sky-600"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={quickPasteMaskStrength}
                        onChange={e => setQuickPasteMaskStrength(parseInt(e.target.value, 10))}
                      />
                      <div className="space-y-2">
                        <Text className="text-[15px] font-semibold">
                          {t('Material preview', { ns: 'settings2' })}
                        </Text>
                        <div
                          className="relative h-72 overflow-hidden rounded border border-slate-300 dark:border-slate-700"
                          style={{
                            backgroundImage: `url(${materialPreviewDesktopUrl})`,
                            backgroundPosition: 'center center',
                            backgroundSize: 'cover',
                          }}
                        >
                          <div className="absolute inset-0 bg-black/10" />
                          <div
                            className="absolute left-1/2 top-1/2 w-[82%] max-w-[390px] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-[#444444] shadow-2xl"
                            style={{
                              backgroundColor: `rgb(${materialPreviewTintChannel} ${materialPreviewTintChannel} ${materialPreviewTintChannel} / ${quickPasteAcrylicOpacity}%)`,
                              backdropFilter: 'blur(22px) saturate(130%)',
                              WebkitBackdropFilter: 'blur(22px) saturate(130%)',
                            }}
                          >
                            <div
                              className="p-3"
                              style={{
                                fontFamily:
                                  "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif",
                                fontSize: `${quickPasteFontSize}px`,
                              }}
                            >
                              <div
                                className="overflow-hidden border border-[#444444] text-[#fffff8]"
                                style={{
                                  backgroundColor: `rgb(0 0 0 / ${quickPasteMaskStrength}%)`,
                                }}
                              >
                                <div className="flex h-10 items-center px-3 text-white">
                                  在此处输入以搜索
                                </div>
                                <div className="mx-3 h-px bg-[#444444]" />
                                <div
                                  className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center px-3"
                                  style={{ backgroundColor: quickPasteHighlightColor }}
                                >
                                  <span className="truncate">Selected clipboard item</span>
                                  <span className="ml-3 tabular-nums text-white/70">1</span>
                                </div>
                                <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center px-3">
                                  <span className="truncate">Clipboard item preview</span>
                                  <span className="ml-3 tabular-nums text-white/50">2</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setQuickPasteAcrylicOpacity(86)
                          setQuickPasteAcrylicColorDepth(100)
                          setQuickPasteMaskStrength(72)
                          setQuickPasteFontSize(16)
                          setQuickPasteHighlightColor('#2563eb')
                        }}
                        className="text-sm bg-slate-200 dark:bg-slate-700 dark:text-slate-200"
                      >
                        {t('Reset Quick Paste style', { ns: 'settings2' })}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card
                  className={`${
                    !isSwapPanels && 'opacity-80 bg-gray-100 dark:bg-gray-900/80'
                  }`}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="animate-in fade-in text-md font-medium w-full">
                      {t('Swap Panels Layout', { ns: 'common' })}
                    </CardTitle>
                    <Switch
                      checked={isSwapPanels}
                      disabled={isSinglePanelView}
                      className="ml-auto"
                      onCheckedChange={() => setIsSwapPanels(!isSwapPanels)}
                    />
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm text-muted-foreground">
                      {t(
                        'Switch the layout position of panels in Clipboard History and Paste Menu views',
                        { ns: 'settings' }
                      )}
                    </Text>
                  </CardContent>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card
                  className={`${
                    !isSimplifiedLayout && 'opacity-80 bg-gray-100 dark:bg-gray-900/80'
                  }`}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                    <CardTitle className="animate-in fade-in text-md font-medium w-full">
                      {t('Simplified Panel Layout', { ns: 'settings2' })}
                    </CardTitle>
                    <Switch
                      checked={isSimplifiedLayout}
                      className="ml-auto"
                      onCheckedChange={() => setIsSimplifiedLayout(!isSimplifiedLayout)}
                    />
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm text-muted-foreground">
                      {t(
                        'Enable simplified, less boxy layout for a cleaner and more streamlined interface design',
                        { ns: 'settings2' }
                      )}
                    </Text>
                  </CardContent>
                </Card>
              </Box>

              <Box className="animate-in fade-in max-w-xl mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="animate-in fade-in text-md font-medium">
                      {t('Panel Visibility', { ns: 'settings2' })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Text className="text-[15px] font-semibold">
                          {t('Show History Panel Only', { ns: 'settings2' })}
                        </Text>
                        <Switch
                          checked={isHistoryPanelVisibleOnly}
                          onCheckedChange={setIsHistoryPanelVisibleOnly}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Text className="text-[15px] font-semibold">
                          {t('Show Boards and Clips Panel Only', { ns: 'settings2' })}
                        </Text>
                        <Switch
                          checked={isSavedClipsPanelVisibleOnly}
                          onCheckedChange={setIsSavedClipsPanelVisibleOnly}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Text className="text-[15px] font-semibold">
                          {t('Show Both Panels', { ns: 'settings2' })}
                        </Text>
                        <Switch
                          checked={
                            !isSavedClipsPanelVisibleOnly && !isHistoryPanelVisibleOnly
                          }
                          onCheckedChange={setShowBothPanels}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Box>

              {[
                {
                  title: t('Show navbar elements on hover only', { ns: 'settings2' }),
                  checked: isShowNavBarItemsOnHoverOnly,
                  onChange: () =>
                    setIsShowNavBarItemsOnHoverOnly(!isShowNavBarItemsOnHoverOnly),
                },
                {
                  title: t('Hide collections menu on the navbar', { ns: 'settings2' }),
                  checked: isHideCollectionsOnNavBar,
                  onChange: () =>
                    setIsHideCollectionsOnNavBar(!isHideCollectionsOnNavBar),
                },
                {
                  title: t('Show collection name on the navbar', { ns: 'settings' }),
                  checked: isShowCollectionNameOnNavBar,
                  onChange: () =>
                    setIsShowCollectionNameOnNavBar(!isShowCollectionNameOnNavBar),
                },
                {
                  title: t('Show disabled collections on the navbar list', {
                    ns: 'settings',
                  }),
                  checked: isShowDisabledCollectionsOnNavBarMenu,
                  onChange: () =>
                    setIsShowDisabledCollectionsOnNavBarMenu(
                      !isShowDisabledCollectionsOnNavBarMenu
                    ),
                },
              ].map(item => (
                <Box key={item.title} className="animate-in fade-in max-w-xl mt-4">
                  <Card
                    className={`${
                      !item.checked && 'opacity-80 bg-gray-100 dark:bg-gray-900/80'
                    }`}
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                      <CardTitle className="animate-in fade-in text-md font-medium w-full">
                        {item.title}
                      </CardTitle>
                      <Switch
                        checked={item.checked}
                        className="ml-auto"
                        onCheckedChange={item.onChange}
                      />
                    </CardHeader>
                  </Card>
                </Box>
              ))}
            </SimpleBar>
          </Box>
        )
      }
    </AutoSize>
  )
}
