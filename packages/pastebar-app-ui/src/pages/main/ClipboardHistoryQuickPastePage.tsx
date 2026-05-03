import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UniqueIdentifier } from '@dnd-kit/core'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/tauri'
import { appWindow } from '@tauri-apps/api/window'
import { isKeyAltPressed, isKeyCtrlPressed, settingsStoreAtom } from '~/store'
import { useAtomValue } from 'jotai'
import { throttle } from 'lodash-es'
import { ArrowDownFromLine, ArrowUpToLine, Search } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { Prism } from 'prism-react-renderer'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import { VariableSizeList } from 'react-window'
import InfiniteLoader from 'react-window-infinite-loader'
import useResizeObserver from 'use-resize-observer'

import { getAppHotkey } from '~/lib/app-hotkeys'

import mergeRefs from '~/components/atoms/merge-refs'
import ToolTip from '~/components/atoms/tooltip'
import { Box, ButtonGhost, Flex, Input, Text } from '~/components/ui'

import { clipboardHistoryStoreAtom } from '~/store/clipboardHistoryStore'
import { themeStoreAtom } from '~/store/themeStore'
import { uiStoreAtom } from '~/store/uiStore'

import {
  useFindClipboardHistory,
  useGetPinnedClipboardHistories,
  useInfiniteClipboardHistory,
  useMovePinnedClipboardHistoryUpDown,
} from '~/hooks/queries/use-history-items'
import { useDebounce } from '~/hooks/use-debounce'
import { useSignal } from '~/hooks/use-signal'

import { ClipboardHistoryItem } from '~/types/history'

import { ClipboardHistoryQuickPasteRow } from '../components/ClipboardHistory/ClipboardHistoryQuickPasteRow'

const altKeys = ['Alt', 'Meta']
const ctrlKeys = ['Control']
const keyUp = ['ArrowUp', 'Up']
const keyPageUp = ['PageUp']
const keyPageDown = ['PageDown']
const keyDown = ['ArrowDown', 'Down']
const keyEnter = ['Enter']
const keyEscape = ['Escape']
const keyHome = ['Home']
const DEFAULT_QUICKPASTE_SEQUENCE_SEPARATOR = '\n'

const toCssFontFamily = (fontFamily: string) => `"${fontFamily.replace(/"/g, '\\"')}"`

const loadPrismComponents = async () => {
  // @ts-expect-error - global Prism
  window.Prism = Prism

  // Load markup-templating first as it's a dependency for PHP
  // @ts-expect-error
  await import('prismjs/components/prism-markup-templating')

  await Promise.all([
    // @ts-expect-error
    import('prismjs/components/prism-json'),
    // @ts-expect-error
    import('prismjs/components/prism-java'),
    // @ts-expect-error
    import('prismjs/components/prism-c'),
    // @ts-expect-error
    import('prismjs/components/prism-css'),
    // @ts-expect-error
    import('prismjs/components/prism-csharp'),
    // @ts-expect-error
    import('prismjs/components/prism-php'),
    // @ts-expect-error
    import('prismjs/components/prism-regex'),
    // @ts-expect-error
    import('prismjs/components/prism-ruby'),
    // @ts-expect-error
    import('prismjs/components/prism-shell-session.js'),
    // @ts-expect-error
    import('prismjs/components/prism-sql'),
    // @ts-expect-error
    import('prismjs/components/prism-uri'),
    // @ts-expect-error
    import('prismjs/components/prism-yaml'),
    // @ts-expect-error
    import('prismjs/components/prism-markdown'),
    // @ts-expect-error
    import('prismjs/components/prism-dart'),
    // @ts-expect-error
    import('~/libs/prismjs/components/prism-path'),
  ])
  Prism.languages['shell'] = Prism.languages['shell-session']
}

async function invokeCopyPasteHistoryItems(
  historyIds: UniqueIdentifier[],
  isQuickPasteCopyOnly: boolean,
  isQuickPasteAutoClose: boolean,
  separator: string,
  prefixSeparator: boolean
) {
  try {
    if (historyIds.length === 0) {
      return false
    }

    if (isQuickPasteCopyOnly) {
      await invoke('quickpaste_copy_history_items', {
        historyIds: historyIds.map(historyId => String(historyId)),
        separator,
        prefixSeparator,
      })
      if (isQuickPasteAutoClose) {
        appWindow?.close()
      }
      return true
    }

    await invoke('quickpaste_paste_many', {
      historyIds: historyIds.map(historyId => String(historyId)),
      separator,
      prefixSeparator,
      closeAfter: isQuickPasteAutoClose,
    })
    return true
  } catch (error) {
    console.error('Error copying/pasting history items:', error)
    return false
  }
}

export default function ClipboardHistoryQuickPastePage() {
  const [savingItem, setSavingItem] = useState<UniqueIdentifier | null>(null)
  const isShowSearch = useSignal(false)
  const { movePinnedClipboardHistoryUpDown } = useMovePinnedClipboardHistoryUpDown()

  const {
    isAutoPreviewLinkCardsEnabled,
    isAutoGenerateLinkCardsEnabled,
    isQuickPasteCopyOnly,
    isQuickPasteAutoClose,
    isSingleClickToCopyPaste,
    isSingleClickKeyboardFocus,
    isSingleClickToCopyPasteQuickWindow,
    historyPreviewLineLimit,
    appHotkeys,
    pasteSequenceEachSeparator,
    quickPasteAcrylicOpacity,
    quickPasteFontSize,
    quickPasteLatinFontFamily,
    quickPasteCjkFontFamily,
    quickPasteHighlightColor,
  } = useAtomValue(settingsStoreAtom)

  const [historyFilters, setHistoryFilters] = useState<string[]>([])
  const [codeFilters, setCodeFilters] = useState<string[]>([])
  const [appFilters, setAppFilters] = useState<string[]>([])

  const historyListSimpleBarRef = useRef<HTMLDivElement | null>(null)

  const [brokenImageItems, setBrokenImageItems] = useState<UniqueIdentifier[]>([])
  const [expandedItems, setExpandedItems] = useState<UniqueIdentifier[]>([])
  const [wrappedTextItems, setWrappedTextItems] = useState<UniqueIdentifier[]>([])
  const { setIsScrolling, isScrolling, isWindows, setReturnRoute } =
    useAtomValue(uiStoreAtom)

  const { t } = useTranslation()

  const [isShowHistoryPinned, setIsShowHistoryPinned] = useState(false)

  const { themeDark } = useAtomValue(themeStoreAtom)
  const { ref: pinnedPanelRef, height: pinnedPanelHeight } = useResizeObserver()
  const { ref: historyPanelRef, height: historyPanelHeight } = useResizeObserver()

  const { pinnedClipboardHistory } = useGetPinnedClipboardHistories()
  const [quickPasteClipboardHistory, setQuickPasteClipboardHistory] = useState<
    ClipboardHistoryItem[]
  >([])
  const [quickPasteHighlightedIndexes, setQuickPasteHighlightedIndexes] = useState<
    number[]
  >([])
  const [quickPastePinnedClipboardHistory, setQuickPastePinnedClipboardHistory] =
    useState<ClipboardHistoryItem[]>([])

  const isDark = themeDark()

  const onCopyHistoryItem = useCallback(async (historyId: UniqueIdentifier) => {
    await invoke('quickpaste_copy_history_item', { historyId })
  }, [])

  const {
    setHistoryListSimpleBar,
    scrollToTopHistoryList,
    addToClipboardHistoryIdsURLErrors,
    addToGenerateLinkMetaDataInProgress,
    removeToGenerateLinkMetaDataInProgress,
    clipboardHistoryGenerateLinkMetaDataInProgress,
    clipboardHistoryIdsURLErrors,
    generateLinkMetaData,
    removeLinkMetaData,
  } = useAtomValue(clipboardHistoryStoreAtom)

  const keyboardIndexSelectedItem = useSignal<number>(-1)
  const keyboardIndexSelectedPinnedItem = useSignal<number>(-1)

  const [isPrismLoaded] = useState(true)

  const {
    isClipboardInfiniteHistoryLoading,
    isClipboardHistoryFetchingNextPage,
    infiniteClipboardHistory,
    invalidateClipboardHistoryQuery,
    fetchNextClipboardHistoryPage,
  } = useInfiniteClipboardHistory()

  const {
    clipboardHistory: allClipboardHistory,
    newClipboardHistoryCount,
    foundClipboardHistory,
  } = useAtomValue(clipboardHistoryStoreAtom)

  const [searchTerm, setSearchTerm] = useState('')
  const [currentTopItemTimeAgo, setCurrentTopItemTimeAgo] = useState('')

  const listRef = useRef(null)
  const rowHeights = useRef<{ [key: string]: number }>({})
  const searchHistoryInputRef = useRef<HTMLInputElement | null>(null)
  const quickPasteIndexHistoryIdsRef = useRef<UniqueIdentifier[]>([])
  const quickPasteDigitSelectedIndexesRef = useRef<number[]>([])
  const quickPastePressedDigitKeysRef = useRef<Set<string>>(new Set())
  const hasQuickPastePastedRef = useRef(false)
  const quickPastePasteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const quickPasteQueuedHistoryIdsRef = useRef<Set<string>>(new Set())
  const pendingQuickPasteHistoryIdsRef = useRef<UniqueIdentifier[]>([])
  const pendingQuickPasteCloseAfterRef = useRef(false)

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  const onScrollCallback = throttle(
    () => {
      if (!isScrolling) {
        setIsScrolling(true)
      }
    },
    300,
    { leading: true }
  )

  const hasSearchOrFilter = useMemo(() => {
    return debouncedSearchTerm.length > 1 || historyFilters.length > 0
  }, [debouncedSearchTerm, historyFilters])

  useEffect(() => {
    if (allClipboardHistory.length === 0) {
      return
    }

    setQuickPasteClipboardHistory(current => {
      if (current.length === 0) {
        return allClipboardHistory
      }

      const isSameLoadedPrefix = current.every(
        (item, index) => allClipboardHistory[index]?.historyId === item.historyId
      )

      if (isSameLoadedPrefix && allClipboardHistory.length > current.length) {
        return allClipboardHistory
      }

      return current
    })
  }, [allClipboardHistory])

  useEffect(() => {
    if (
      quickPastePinnedClipboardHistory.length === 0 &&
      pinnedClipboardHistory.length > 0
    ) {
      setQuickPastePinnedClipboardHistory(pinnedClipboardHistory)
    }
  }, [pinnedClipboardHistory, quickPastePinnedClipboardHistory.length])

  const clipboardHistory = hasSearchOrFilter
    ? foundClipboardHistory
    : quickPasteClipboardHistory

  const visiblePinnedClipboardHistory = hasSearchOrFilter
    ? pinnedClipboardHistory
    : quickPastePinnedClipboardHistory

  useEffect(() => {
    if (
      quickPasteIndexHistoryIdsRef.current.length === 0 &&
      quickPasteClipboardHistory.length > 0
    ) {
      quickPasteIndexHistoryIdsRef.current = quickPasteClipboardHistory
        .slice(0, 10)
        .map(item => item.historyId)
    }
  }, [quickPasteClipboardHistory])

  const { refetchFindClipboardHistory } = useFindClipboardHistory({
    query: debouncedSearchTerm,
    filters: historyFilters,
    codeFilters,
    appFilters,
  })

  const keyboardSelectedItemId = useMemo(() => {
    if (keyboardIndexSelectedItem.value >= 0) {
      setIsShowHistoryPinned(false)
      keyboardIndexSelectedPinnedItem.value = -1
    }

    return clipboardHistory.length > 0 &&
      clipboardHistory[keyboardIndexSelectedItem.value]
      ? clipboardHistory[keyboardIndexSelectedItem.value].historyId
      : null
  }, [
    keyboardIndexSelectedItem.value,
    clipboardHistory,
    keyboardIndexSelectedPinnedItem.value,
  ])

  const keyboardSelectedPinnedItemId = useMemo(() => {
    if (keyboardIndexSelectedPinnedItem.value > 0) {
      keyboardIndexSelectedItem.value = -1
    }
    return visiblePinnedClipboardHistory.length > 0 &&
      visiblePinnedClipboardHistory[keyboardIndexSelectedPinnedItem.value]
      ? visiblePinnedClipboardHistory[keyboardIndexSelectedPinnedItem.value].historyId
      : null
  }, [
    keyboardIndexSelectedPinnedItem.value,
    visiblePinnedClipboardHistory,
    keyboardIndexSelectedItem.value,
  ])

  const quickPasteHighlightedHistoryIds = useMemo(() => {
    return new Set(
      quickPasteHighlightedIndexes
        .map(index => quickPasteIndexHistoryIdsRef.current[index])
        .filter(Boolean)
    )
  }, [quickPasteHighlightedIndexes])

  const doRefetchFindClipboardHistory = useCallback(() => {
    if (hasSearchOrFilter) {
      refetchFindClipboardHistory()
      keyboardIndexSelectedPinnedItem.value = -1
      keyboardIndexSelectedItem.value = 0
    }
  }, [
    hasSearchOrFilter,
    keyboardIndexSelectedPinnedItem.value,
    keyboardIndexSelectedItem.value,
  ])

  const toggleSearch = (e: KeyboardEvent) => {
    e.preventDefault()
    if (keyboardIndexSelectedPinnedItem.value > 0) {
      keyboardIndexSelectedPinnedItem.value = -1
      keyboardIndexSelectedItem.value = 0
    }
    isShowSearch.value = !isShowSearch.value
  }

  useEffect(() => {
    if (searchHistoryInputRef?.current && isShowSearch.value) {
      searchHistoryInputRef?.current?.focus()
      // Set cursor position to end when search is activated with initial text
      if (searchTerm.length > 0) {
        requestAnimationFrame(() => {
          searchHistoryInputRef?.current?.setSelectionRange(
            searchTerm.length,
            searchTerm.length
          )
        })
      }
    }
  }, [isShowSearch.value])

  const pasteQuickPasteHistoryIds = useCallback(
    (historyIds: UniqueIdentifier[], closeAfter = false) => {
      const itemIds = historyIds.filter((itemId): itemId is UniqueIdentifier => {
        if (!itemId) {
          return false
        }

        const historyId = String(itemId)
        if (quickPasteQueuedHistoryIdsRef.current.has(historyId)) {
          return false
        }

        quickPasteQueuedHistoryIdsRef.current.add(historyId)
        return true
      })

      if (itemIds.length === 0) {
        return
      }

      quickPastePasteQueueRef.current = quickPastePasteQueueRef.current.then(async () => {
        try {
          const didPaste = await invokeCopyPasteHistoryItems(
            itemIds,
            isQuickPasteCopyOnly,
            closeAfter,
            pasteSequenceEachSeparator || DEFAULT_QUICKPASTE_SEQUENCE_SEPARATOR,
            hasQuickPastePastedRef.current
          )

          if (didPaste && !isQuickPasteCopyOnly) {
            hasQuickPastePastedRef.current = true
          }
        } finally {
          itemIds.forEach(itemId => {
            quickPasteQueuedHistoryIdsRef.current.delete(String(itemId))
          })
        }
      })
    },
    [isQuickPasteCopyOnly, pasteSequenceEachSeparator]
  )

  const pasteQuickPasteIndexes = useCallback(
    (indexes: number[], closeAfter = false) => {
      const uniqueIndexes = indexes.filter(
        (index, position) => indexes.indexOf(index) === position
      )
      const historyIds = uniqueIndexes
        .map(index => quickPasteIndexHistoryIdsRef.current[index])
        .filter((itemId): itemId is UniqueIdentifier => Boolean(itemId))

      pasteQuickPasteHistoryIds(historyIds, closeAfter)
    },
    [pasteQuickPasteHistoryIds]
  )

  const onCopyPasteHistoryItem = useCallback(
    (historyId: UniqueIdentifier) => {
      pasteQuickPasteHistoryIds([historyId], isQuickPasteAutoClose)
    },
    [isQuickPasteAutoClose, pasteQuickPasteHistoryIds]
  )

  useEffect(() => {
    invoke('set_quickpaste_search_active', { isActive: isShowSearch.value })
  }, [isShowSearch.value])

  useHotkeys(getAppHotkey(appHotkeys, 'quickPasteSearch'), toggleSearch)

  useEffect(() => {
    const unlistenShowSearch = listen('quickpaste-show-search', async () => {
      isShowSearch.value = true
      await appWindow.setFocus()
    })

    return () => {
      unlistenShowSearch.then(unlisten => unlisten())
    }
  }, [])

  useEffect(() => {
    const listenToClipboardUnlisten = listen(
      'clipboard://clipboard-monitor/update',
      e => {
        if (e.payload === 'clipboard update') {
          doRefetchFindClipboardHistory()
        }
      }
    )

    return () => {
      listenToClipboardUnlisten.then(unlisten => {
        unlisten()
      })
    }
  }, [doRefetchFindClipboardHistory])

  useEffect(() => {
    setReturnRoute(location.pathname)

    const prismLoadTimer = window.setTimeout(() => {
      loadPrismComponents()
    }, 200)

    return () => {
      window.clearTimeout(prismLoadTimer)
    }
  }, [])

  useEffect(() => {
    if (historyListSimpleBarRef.current) {
      setHistoryListSimpleBar(historyListSimpleBarRef)
      historyListSimpleBarRef.current.addEventListener('scroll', onScrollCallback)
    }
  }, [historyListSimpleBarRef.current])

  useEffect(() => {
    if (
      debouncedSearchTerm.length > 1 ||
      historyFilters.length > 0 ||
      appFilters.length > 0 ||
      codeFilters.length > 0
    ) {
      refetchFindClipboardHistory()
      scrollToTopHistoryList()
      keyboardIndexSelectedPinnedItem.value = -1
      keyboardIndexSelectedItem.value = 0
    }
  }, [debouncedSearchTerm, historyFilters, codeFilters, appFilters])

  const loadMoreClipBoardHistory = async () => {
    if (!isClipboardHistoryFetchingNextPage) {
      await fetchNextClipboardHistoryPage({ cancelRefetch: false })
    }
  }

  function getRowHeight(index: number): number {
    return rowHeights.current[index] || 60
  }

  function setRowHeight(index: number, size: number) {
    // @ts-expect-error - resetAfterIndex is not in the types
    listRef.current?.resetAfterIndex && listRef.current?.resetAfterIndex(0)
    rowHeights.current = { ...rowHeights.current, [index]: size }
  }

  const setBrokenImageItem = useCallback(
    (id: UniqueIdentifier) => {
      setBrokenImageItems(prev => {
        const isSelected = prev.includes(id)
        return isSelected ? prev.filter(_id => _id !== id) : [...prev, id]
      })
    },
    [setBrokenImageItems]
  )

  const setExpanded = useCallback(
    (id: UniqueIdentifier, isExpanded: boolean) => {
      setExpandedItems(prev => {
        if (isExpanded) {
          return [...prev, id]
        } else {
          return prev.filter(item => item !== id)
        }
      })
    },
    [setExpandedItems]
  )

  const setWrapText = useCallback(
    (id: UniqueIdentifier, isWrapped: boolean) => {
      setWrappedTextItems(prev => {
        if (isWrapped) {
          return [...prev, id]
        } else {
          return prev.filter(item => item !== id)
        }
      })
    },
    [setWrappedTextItems]
  )

  function hasAltKey(event: KeyboardEvent) {
    return altKeys.includes(event.key)
  }

  function hasCtrlKey(event: KeyboardEvent) {
    return ctrlKeys.includes(event.key)
  }

  function getQuickPasteDigitIndex(event: KeyboardEvent) {
    if (
      isShowSearch.value ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1 ||
      !/^[0-9]$/.test(event.key)
    ) {
      return null
    }

    return event.key === '0' ? 9 : Number(event.key) - 1
  }

  async function downHandler(event: KeyboardEvent) {
    if (isScrolling) {
      setIsScrolling(false)
    }

    if (hasAltKey(event)) {
      isKeyAltPressed.value = true
    }
    if (hasCtrlKey(event)) {
      isKeyCtrlPressed.value = true
    }

    const quickPasteDigitIndex = getQuickPasteDigitIndex(event)

    if (quickPasteDigitIndex !== null) {
      event.preventDefault()
      if (event.repeat) {
        return
      }

      quickPastePressedDigitKeysRef.current.add(event.code)

      if (!quickPasteDigitSelectedIndexesRef.current.includes(quickPasteDigitIndex)) {
        quickPasteDigitSelectedIndexesRef.current = [
          ...quickPasteDigitSelectedIndexesRef.current,
          quickPasteDigitIndex,
        ]
        setQuickPasteHighlightedIndexes(quickPasteDigitSelectedIndexesRef.current)
      }
      return
    }

    if (
      !isShowSearch.value &&
      !isWindows &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.length === 1 &&
      event.key !== '/'
    ) {
      event.preventDefault()
      invoke('close_quickpaste_restore_focus')
      return
    }

    // Handle Escape key before the early return for search input
    if (keyEscape.includes(event.key)) {
      event.preventDefault()
      invoke('close_quickpaste_restore_focus')
      return
    }

    // If search is active and input is focused, only process navigation keys
    if (isShowSearch.value && document.activeElement === searchHistoryInputRef?.current) {
      // Allow navigation keys to be processed
      if (
        !keyUp.includes(event.key) &&
        !keyDown.includes(event.key) &&
        !keyPageUp.includes(event.key) &&
        !keyPageDown.includes(event.key) &&
        !keyHome.includes(event.key) &&
        !keyEnter.includes(event.key)
      ) {
        return
      }
    }

    if (keyHome.includes(event.key)) {
      if (!isShowSearch.value) {
        event.preventDefault()
      } else {
        return
      }
      keyboardIndexSelectedPinnedItem.value = -1
      const prevSelectedItem = clipboardHistory[0]?.historyId
      if (prevSelectedItem) {
        keyboardIndexSelectedItem.value = 0
        scrollToTopHistoryList()
      }
      return
    }

    if (keyUp.includes(event.key)) {
      event.preventDefault()
      if (keyboardIndexSelectedPinnedItem.value > -1) {
        const prevSelectedPinnedItem =
          visiblePinnedClipboardHistory[keyboardIndexSelectedPinnedItem.value - 1]
            ?.historyId

        keyboardIndexSelectedItem.value = -1
        if (prevSelectedPinnedItem) {
          keyboardIndexSelectedPinnedItem.value =
            keyboardIndexSelectedPinnedItem.value - 1
        } else {
          keyboardIndexSelectedPinnedItem.value = 0
        }
        return
      }
      const prevSelectedItem =
        clipboardHistory[keyboardIndexSelectedItem.value - 1]?.historyId
      if (prevSelectedItem) {
        keyboardIndexSelectedItem.value -= 1
      } else {
        if (visiblePinnedClipboardHistory.length > 0 && !isShowSearch.value) {
          if (!isShowHistoryPinned) {
            setIsShowHistoryPinned(true)
          }
          keyboardIndexSelectedItem.value = -1
          keyboardIndexSelectedPinnedItem.value = visiblePinnedClipboardHistory.length - 1
        } else {
          keyboardIndexSelectedItem.value = 0
        }
      }
      return
    }

    if (keyDown.includes(event.key)) {
      event.preventDefault()
      if (keyboardIndexSelectedPinnedItem.value > -1) {
        const nextSelectedPinnedItem =
          visiblePinnedClipboardHistory[keyboardIndexSelectedPinnedItem.value + 1]
            ?.historyId

        if (nextSelectedPinnedItem) {
          keyboardIndexSelectedItem.value = -1
          keyboardIndexSelectedPinnedItem.value += 1
        } else {
          keyboardIndexSelectedPinnedItem.value = -1
          keyboardIndexSelectedItem.value = 0
        }
        return
      }

      const nextSelectedItem =
        clipboardHistory[keyboardIndexSelectedItem.value + 1]?.historyId

      if (nextSelectedItem) {
        keyboardIndexSelectedItem.value += 1
      } else {
        if (
          keyboardIndexSelectedItem.value < 0 &&
          visiblePinnedClipboardHistory.length > 0
        ) {
          keyboardIndexSelectedItem.value += 1
        }
      }
      return
    }

    if (keyPageUp.includes(event.key)) {
      event.preventDefault()
      keyboardIndexSelectedPinnedItem.value = -1
      const prevSelectedItem =
        clipboardHistory[keyboardIndexSelectedItem.value - 5]?.historyId
      if (prevSelectedItem) {
        keyboardIndexSelectedItem.value -= 5
      } else {
        keyboardIndexSelectedItem.value = 0
      }
      return
    }

    if (keyPageDown.includes(event.key)) {
      event.preventDefault()
      keyboardIndexSelectedPinnedItem.value = -1
      const nextSelectedItem =
        clipboardHistory[keyboardIndexSelectedItem.value + 5]?.historyId

      if (nextSelectedItem) {
        keyboardIndexSelectedItem.value += 5
      } else {
        keyboardIndexSelectedItem.value = clipboardHistory.length - 1
      }
      return
    }

    if (keyEnter.includes(event.key)) {
      event.preventDefault()
      if (event.repeat) {
        return
      }

      const selectedItemId =
        keyboardIndexSelectedPinnedItem.value > -1
          ? visiblePinnedClipboardHistory[keyboardIndexSelectedPinnedItem.value]
              ?.historyId
          : clipboardHistory[keyboardIndexSelectedItem.value]?.historyId

      if (selectedItemId) {
        pendingQuickPasteHistoryIdsRef.current = [selectedItemId]
        pendingQuickPasteCloseAfterRef.current = isQuickPasteAutoClose
      }
      return
    }
    return
  }

  function upHandler(event: KeyboardEvent) {
    if (hasAltKey(event)) {
      isKeyAltPressed.value = false
    }
    if (hasCtrlKey(event)) {
      isKeyCtrlPressed.value = false
    }

    const quickPasteDigitIndex = getQuickPasteDigitIndex(event)

    if (quickPasteDigitIndex !== null) {
      event.preventDefault()
      quickPastePressedDigitKeysRef.current.delete(event.code)

      if (
        quickPastePressedDigitKeysRef.current.size === 0 &&
        quickPasteDigitSelectedIndexesRef.current.length > 0
      ) {
        const indexes = [...quickPasteDigitSelectedIndexesRef.current]
        quickPasteDigitSelectedIndexesRef.current = []
        setQuickPasteHighlightedIndexes([])
        pasteQuickPasteIndexes(indexes)
      }
      return
    }

    if (keyEnter.includes(event.key) && pendingQuickPasteHistoryIdsRef.current.length) {
      event.preventDefault()
      const pendingHistoryIds = [...pendingQuickPasteHistoryIdsRef.current]
      const closeAfter = pendingQuickPasteCloseAfterRef.current
      pendingQuickPasteHistoryIdsRef.current = []
      pendingQuickPasteCloseAfterRef.current = false
      pasteQuickPasteHistoryIds(pendingHistoryIds, closeAfter)
    }
  }

  function focusHandler() {
    isKeyAltPressed.value = false
    isKeyCtrlPressed.value = false
  }

  useEffect(() => {
    window.addEventListener('keydown', downHandler)
    window.addEventListener('keyup', upHandler)
    window.addEventListener('focus', focusHandler)

    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
      window.removeEventListener('focus', focusHandler)
    }
  }, [
    clipboardHistory,
    visiblePinnedClipboardHistory,
    isShowSearch.value,
    searchTerm,
    keyboardIndexSelectedItem.value,
    keyboardIndexSelectedPinnedItem.value,
    isQuickPasteAutoClose,
    pasteQuickPasteHistoryIds,
    pasteQuickPasteIndexes,
  ])

  return (
    isPrismLoaded && (
      <Box
        ref={historyPanelRef}
        className="quick-paste-window quick-paste-flow-window h-dvh flex flex-col overflow-hidden"
        style={
          {
            '--quick-paste-font-size': `${quickPasteFontSize}px`,
            '--quick-paste-latin-font-family': toCssFontFamily(quickPasteLatinFontFamily),
            '--quick-paste-cjk-font-family': toCssFontFamily(quickPasteCjkFontFamily),
            '--quick-paste-highlight-color': quickPasteHighlightColor,
            '--quick-paste-acrylic-opacity': `${quickPasteAcrylicOpacity / 100}`,
          } as React.CSSProperties
        }
      >
        <Box className="flow-query-box-area">
          <SearchInput
            key="search-input"
            setSearchTerm={setSearchTerm}
            searchTerm={searchTerm}
            searchHistoryInputRef={searchHistoryInputRef}
            t={t}
            isActive={isShowSearch.value}
            onActivate={() => {
              isShowSearch.value = true
            }}
          />
        </Box>

        {(clipboardHistory.length > 0 ||
          visiblePinnedClipboardHistory.length > 0 ||
          hasSearchOrFilter) && <Box className="flow-middle-separator" />}

        <Box className="flow-result-preview-area flex flex-col relative" id="side-panel_tour">
          {hasSearchOrFilter ? (
            <Box className="flow-found-pill cursor-pointer absolute z-100 animate-in fade-in fade-out flex justify-center w-full pointer-events-none">
              <ToolTip
                text={t('Clear found results and filters', { ns: 'common' })}
                className="animate-in fade-in fade-out duration-300"
                isCompact
                delayDuration={2000}
                side="top"
                onClick={() => {
                  setSearchTerm('')
                  setHistoryFilters([])
                  setCodeFilters([])
                  setAppFilters([])
                  if (
                    searchHistoryInputRef?.current &&
                    searchHistoryInputRef.current.value
                  ) {
                    searchHistoryInputRef.current.value = ''
                    searchHistoryInputRef?.current?.focus()
                  }
                }}
                sideOffset={10}
              >
                <Text className="text-xs text-center dark:text-slate-800 bg-blue-200 dark:bg-blue-400 rounded-full px-3 cursor-pointer pointer-events-auto">
                  {clipboardHistory.length ? (
                    <>
                      {clipboardHistory.length < 100 ? clipboardHistory.length : '100+'}{' '}
                      {t('found', { ns: 'common' })}
                    </>
                  ) : (
                    <>{t('Nothing found', { ns: 'common' })}</>
                  )}
                </Text>
              </ToolTip>
            </Box>
          ) : (
            visiblePinnedClipboardHistory.length > 0 &&
            !isShowSearch.value && (
              <Box
                ref={pinnedPanelRef}
                className="flow-pinned-results relative"
              >
                <OverlayScrollbarsComponent
                  defer
                  style={{
                    maxHeight: 200,
                  }}
                  options={{
                    overflow: {
                      x: 'hidden',
                      y: 'scroll',
                    },
                    scrollbars: {
                      theme: isDark ? 'os-theme-light' : 'os-theme-dark',
                      autoHide: 'move',
                    },
                  }}
                >
                  <Box className={`flex flex-col gap-1 relative`}>
                    {isShowHistoryPinned &&
                      [...visiblePinnedClipboardHistory]
                        .sort((a, b) => a.pinnedOrderNumber - b.pinnedOrderNumber)
                        .map((item, index) => {
                          const historyId = item.historyId
                          return (
                            <ClipboardHistoryQuickPasteRow
                              isPinnedTop
                              isScrolling={isScrolling}
                              setKeyboardSelected={id => {
                                const index = visiblePinnedClipboardHistory.findIndex(
                                  item => item.historyId === id
                                )
                                if (index > -1) {
                                  keyboardIndexSelectedPinnedItem.value = index
                                  keyboardIndexSelectedItem.value = -1
                                }
                              }}
                              isKeyboardSelected={
                                keyboardSelectedPinnedItemId === historyId
                              }
                              hasClipboardHistoryURLErrors={clipboardHistoryIdsURLErrors.includes(
                                historyId
                              )}
                              showSelectHistoryItems={false}
                              setHistoryFilters={setHistoryFilters}
                              setAppFilters={setAppFilters}
                              addToClipboardHistoryIdsURLErrors={
                                addToClipboardHistoryIdsURLErrors
                              }
                              isLinkCardPreviewEnabled={isAutoPreviewLinkCardsEnabled}
                              isAutoGenerateLinkCardsEnabled={
                                isAutoGenerateLinkCardsEnabled
                              }
                              addToGenerateLinkMetaDataInProgress={
                                addToGenerateLinkMetaDataInProgress
                              }
                              removeToGenerateLinkMetaDataInProgress={
                                removeToGenerateLinkMetaDataInProgress
                              }
                              hasGenerateLinkMetaDataInProgress={clipboardHistoryGenerateLinkMetaDataInProgress.includes(
                                historyId
                              )}
                              isPinnedTopFirst={index === 0}
                              isDisabledPinnedMoveUp={index === 0}
                              isDisabledPinnedMoveDown={
                                index === visiblePinnedClipboardHistory.length - 1
                              }
                              onMovePinnedUpDown={move => {
                                movePinnedClipboardHistoryUpDown(move)
                              }}
                              setSelectHistoryItem={() => {}}
                              onCopy={onCopyHistoryItem}
                              onCopyPaste={onCopyPasteHistoryItem}
                              isSaved={historyId === savingItem}
                              setSavingItem={setSavingItem}
                              isDeleting={false}
                              isSelected={false}
                              isWindows={isWindows}
                              setBrokenImageItem={setBrokenImageItem}
                              isBrokenImage={brokenImageItems.includes(historyId)}
                              showTimeAgo={false}
                              isExpanded={expandedItems.includes(historyId)}
                              isWrapText={wrappedTextItems.includes(historyId)}
                              searchTerm={hasSearchOrFilter ? debouncedSearchTerm : ''}
                              invalidateClipboardHistoryQuery={() => {
                                invalidateClipboardHistoryQuery()
                                doRefetchFindClipboardHistory()
                              }}
                              setExpanded={setExpanded}
                              setWrapText={setWrapText}
                              isDark={isDark}
                              setRowHeight={setRowHeight}
                              clipboard={item}
                              removeLinkMetaData={removeLinkMetaData}
                              generateLinkMetaData={generateLinkMetaData}
                              isSingleClickToCopyPaste={
                                isSingleClickToCopyPaste ||
                                isSingleClickToCopyPasteQuickWindow
                              }
                              historyPreviewLineLimit={historyPreviewLineLimit}
                            />
                          )
                        })}
                  </Box>
                </OverlayScrollbarsComponent>
                {!isShowHistoryPinned ? (
                  <Flex className="justify-center flow-pinned-toggle">
                    <ButtonGhost
                      className={`hover:underline ${
                        isShowHistoryPinned ? 'h-[30px]' : 'h-[26px]'
                      } group !text-orange-500/80 dark:!text-orange-400/80 hover:!text-orange-400 hover:bg-transparent dark:hover:bg-transparent ${
                        !isShowHistoryPinned ? 'pb-1' : ''
                      }`}
                      title={
                        isShowHistoryPinned
                          ? t('Hide pinned history', { ns: 'history' })
                          : t('View pinned history', { ns: 'history' })
                      }
                      onClick={() => {
                        setIsShowHistoryPinned(!isShowHistoryPinned)
                      }}
                    >
                      <Text className="!font-medium text-xs !text-orange-500/80 dark:!text-orange-400/80 hover:!text-orange-400 mr-1">
                        {visiblePinnedClipboardHistory.length}{' '}
                        {t('Pinned', {
                          ns: 'common',
                          count: visiblePinnedClipboardHistory.length,
                        })}
                      </Text>
                      {isShowHistoryPinned ? (
                        <ArrowUpToLine
                          size={13}
                          className="group-hover:opacity-100 opacity-0"
                        />
                      ) : (
                        <ArrowDownFromLine
                          size={13}
                          className="group-hover:opacity-100 opacity-0"
                        />
                      )}
                    </ButtonGhost>
                  </Flex>
                ) : (
                  <Box className="mb-2" />
                )}
              </Box>
            )
          )}

          <Box>
            {clipboardHistory.length > 0 || hasSearchOrFilter ? (
              <div className="relative" id="quick-paste-history-list">
                {currentTopItemTimeAgo && (
                  <Box
                    className={`${
                      newClipboardHistoryCount > 0 ? 'top-9' : 'top-1'
                    } absolute z-100 animate-in fade-in fade-out duration-300 flex justify-center w-full ml-[-5px] pointer-events-none`}
                  >
                    <ToolTip
                      text={t('Scroll to Top', { ns: 'common' })}
                      className="animate-in fade-in fade-out duration-300"
                      isCompact
                      delayDuration={2000}
                      side="bottom"
                      asChild
                      sideOffset={10}
                    >
                      <ButtonGhost
                        className="pointer-events-auto rounded-full bg-slate-300 dark:bg-slate-600 hover:bg-slate-200 hover:dark:bg-slate-700"
                        onClick={() => {
                          scrollToTopHistoryList(true)
                        }}
                      >
                        <Text className="text-mute text-xs text-center px-3">
                          {currentTopItemTimeAgo}
                        </Text>
                      </ButtonGhost>
                    </ToolTip>
                  </Box>
                )}

                <InfiniteLoader
                  isItemLoaded={index =>
                    index < clipboardHistory.length && !!clipboardHistory[index]
                  }
                  threshold={10}
                  itemCount={clipboardHistory.length + 1}
                  loadMoreItems={loadMoreClipBoardHistory}
                >
                  {({ onItemsRendered, ref }) => {
                    return (
                      <VariableSizeList
                        overscanCount={10}
                        style={{ overflowX: 'hidden' }}
                        height={
                          historyPanelHeight
                            ? historyPanelHeight -
                              56 -
                              (visiblePinnedClipboardHistory.length === 0 ||
                              isShowSearch.value
                                ? 0
                                : pinnedPanelHeight
                                  ? pinnedPanelHeight
                                  : 0)
                            : 400
                        }
                        itemCount={clipboardHistory.length}
                        width="100%"
                        itemSize={getRowHeight}
                        itemKey={index =>
                          clipboardHistory[index].historyId ?? 'id-${index}'
                        }
                        onItemsRendered={e => {
                          if (e.visibleStartIndex > 20) {
                            const currentTopItem = clipboardHistory[e.visibleStartIndex]
                            if (currentTopItem?.timeAgo) {
                              if (currentTopItemTimeAgo !== currentTopItem.timeAgo) {
                                setCurrentTopItemTimeAgo(currentTopItem.timeAgo)
                              }
                            } else {
                              setCurrentTopItemTimeAgo('')
                            }
                          } else if (currentTopItemTimeAgo) {
                            setCurrentTopItemTimeAgo('')
                          }
                          !debouncedSearchTerm && onItemsRendered(e)
                        }}
                        outerRef={historyListSimpleBarRef}
                        ref={mergeRefs(listRef, ref)}
                      >
                        {({ index, style }) => {
                          const clipboard = clipboardHistory[index]
                          const { historyId, showTimeAgo, timeAgo } = clipboard

                          return (
                            <ClipboardHistoryQuickPasteRow
                              hasClipboardHistoryURLErrors={clipboardHistoryIdsURLErrors.includes(
                                historyId
                              )}
                              addToGenerateLinkMetaDataInProgress={
                                addToGenerateLinkMetaDataInProgress
                              }
                              isLinkCardPreviewEnabled={isAutoPreviewLinkCardsEnabled}
                              isAutoGenerateLinkCardsEnabled={
                                isAutoGenerateLinkCardsEnabled
                              }
                              isScrolling={isScrolling}
                              removeToGenerateLinkMetaDataInProgress={
                                removeToGenerateLinkMetaDataInProgress
                              }
                              addToClipboardHistoryIdsURLErrors={
                                addToClipboardHistoryIdsURLErrors
                              }
                              hasGenerateLinkMetaDataInProgress={clipboardHistoryGenerateLinkMetaDataInProgress.includes(
                                historyId
                              )}
                              isWindows={isWindows}
                              setHistoryFilters={setHistoryFilters}
                              setAppFilters={setAppFilters}
                              setSelectHistoryItem={() => {}}
                              onCopy={onCopyHistoryItem}
                              onCopyPaste={onCopyPasteHistoryItem}
                              isKeyboardSelected={keyboardSelectedItemId === historyId}
                              isQuickPasteDigitHighlighted={quickPasteHighlightedHistoryIds.has(
                                historyId
                              )}
                              setKeyboardSelected={id => {
                                const index = clipboardHistory.findIndex(
                                  item => item.historyId === id
                                )
                                if (index > -1) {
                                  keyboardIndexSelectedItem.value = index
                                  keyboardIndexSelectedPinnedItem.value = -1
                                }
                              }}
                              setSavingItem={setSavingItem}
                              key={historyId}
                              isDeleting={false}
                              isSelected={false}
                              setBrokenImageItem={setBrokenImageItem}
                              isBrokenImage={brokenImageItems.includes(historyId)}
                              showTimeAgo={showTimeAgo}
                              timeAgo={timeAgo}
                              isExpanded={expandedItems.includes(historyId)}
                              isWrapText={wrappedTextItems.includes(historyId)}
                              searchTerm={hasSearchOrFilter ? debouncedSearchTerm : ''}
                              showSelectHistoryItems={false}
                              invalidateClipboardHistoryQuery={() => {
                                invalidateClipboardHistoryQuery()
                                doRefetchFindClipboardHistory()
                              }}
                              setExpanded={setExpanded}
                              setWrapText={setWrapText}
                              isDark={isDark}
                              setRowHeight={setRowHeight}
                              clipboard={clipboard}
                              removeLinkMetaData={removeLinkMetaData}
                              generateLinkMetaData={generateLinkMetaData}
                              isSingleClickToCopyPaste={
                                isSingleClickToCopyPaste ||
                                isSingleClickToCopyPasteQuickWindow
                              }
                              isSingleClickKeyboardFocus={isSingleClickKeyboardFocus}
                              historyPreviewLineLimit={historyPreviewLineLimit}
                              index={index}
                              style={style}
                            />
                          )
                        }}
                      </VariableSizeList>
                    )
                  }}
                </InfiniteLoader>
              </div>
            ) : (
              !isClipboardInfiniteHistoryLoading &&
              infiniteClipboardHistory?.pages?.flat().length === 0 && (
                <Flex className="flex items-center flex-col gap-3 justify-center">
                  <Text className="animate-in fade-in duration-600 text-slate-300 text-xs bg-slate-100 rounded-full px-3 dark:text-slate-600 dark:bg-slate-900">
                    {t('No Clipboard History', { ns: 'dashboard' })}
                  </Text>
                </Flex>
              )
            )}
          </Box>
        </Box>
      </Box>
    )
  )
}

const SearchInput = React.memo(
  ({
    searchTerm,
    setSearchTerm,
    searchHistoryInputRef,
    t,
    isActive,
    onActivate,
  }: {
    searchTerm: string
    setSearchTerm: (value: string) => void
    searchHistoryInputRef: React.RefObject<HTMLInputElement>
    t: (key: string, options?: Record<string, unknown>) => string
    isActive: boolean
    onActivate: () => void
  }) => (
    <Box className="quick-paste-search-box flex flex-row p-0 items-center">
      <Input
        placeholder={`${t('Find in history', { ns: 'dashboard' })}...`}
        key="search-history"
        type="search"
        onChange={e => {
          const newValue = e.target.value
          if (newValue !== searchTerm) {
            setSearchTerm(newValue)
          }
        }}
        value={searchTerm}
        readOnly={!isActive}
        ref={searchHistoryInputRef}
        iconLeft={<Search className="h-4 w-4" />}
        classNameInput="w-full pr-0"
        className="quick-paste-search-input text-md ring-offset-0 border-r-0 border-t-0 border-b-0"
        onFocus={onActivate}
        onMouseDown={onActivate}
        onKeyDown={e => {
          if (
            !keyEscape.includes(e.key) &&
            !keyUp.includes(e.key) &&
            !keyDown.includes(e.key) &&
            !keyPageUp.includes(e.key) &&
            !keyPageDown.includes(e.key) &&
            !keyHome.includes(e.key) &&
            !keyEnter.includes(e.key)
          ) {
            e.stopPropagation()
          }
        }}
      />
    </Box>
  )
)
