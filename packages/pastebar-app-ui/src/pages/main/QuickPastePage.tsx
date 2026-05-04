import {
  ChangeEvent,
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { listen } from '@tauri-apps/api/event'
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri'
import { appWindow } from '@tauri-apps/api/window'
import { useAtomValue } from 'jotai'

import { clipboardHistoryStoreAtom } from '~/store/clipboardHistoryStore'
import { settingsStoreAtom } from '~/store/settingsStore'

import {
  useFindClipboardHistory,
  useInfiniteClipboardHistory,
} from '~/hooks/queries/use-history-items'
import { useDebounce } from '~/hooks/use-debounce'

export type QuickPasteAppearance = {
  acrylicColorDepth: number
  acrylicOpacity: number
  fontSize: number
  highlightColor: string
  maskEnabled: boolean
  lightMaskColor: string
  lightMaskStrength: number
  darkMaskColor: string
  darkMaskStrength: number
}

type QuickPastePageProps = {
  appearance?: QuickPasteAppearance
  pasteSequenceEachSeparator?: string
}

export default function QuickPastePage({
  appearance,
  pasteSequenceEachSeparator: loadedPasteSequenceEachSeparator,
}: QuickPastePageProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  const [isResultsScrolling, setIsResultsScrolling] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isMouseSelectingRef = useRef(false)
  const pasteQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedIndexesRef = useRef<number[]>([])
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const hasSearch = debouncedSearchTerm.length > 1

  const { fetchNextClipboardHistoryPage, isClipboardHistoryFetchingNextPage } =
    useInfiniteClipboardHistory()

  const { clipboardHistory, foundClipboardHistory } = useAtomValue(
    clipboardHistoryStoreAtom
  )
  const {
    quickPasteHighlightColor,
    quickPasteAcrylicColorDepth,
    quickPasteAcrylicOpacity,
    quickPasteFontSize,
    quickPasteMaskEnabled,
    quickPasteLightMaskColor,
    quickPasteLightMaskStrength,
    quickPasteDarkMaskColor,
    quickPasteDarkMaskStrength,
    pasteSequenceEachSeparator,
  } = useAtomValue(settingsStoreAtom)
  const activePasteSequenceEachSeparator =
    loadedPasteSequenceEachSeparator ?? pasteSequenceEachSeparator
  const activeAppearance = appearance ?? {
    acrylicColorDepth: quickPasteAcrylicColorDepth,
    acrylicOpacity: quickPasteAcrylicOpacity,
    fontSize: quickPasteFontSize,
    highlightColor: quickPasteHighlightColor,
    maskEnabled: quickPasteMaskEnabled,
    lightMaskColor: quickPasteLightMaskColor,
    lightMaskStrength: quickPasteLightMaskStrength,
    darkMaskColor: quickPasteDarkMaskColor,
    darkMaskStrength: quickPasteDarkMaskStrength,
  }
  const visibleClipboardHistory = hasSearch ? foundClipboardHistory : clipboardHistory
  const visibleClipboardHistoryRef = useRef(visibleClipboardHistory)

  const { refetchFindClipboardHistory } = useFindClipboardHistory({
    query: debouncedSearchTerm,
    filters: [],
    codeFilters: [],
    appFilters: [],
  })

  const selectedIndexSet = useMemo(() => new Set(selectedIndexes), [selectedIndexes])

  const updateSelectedIndexes = useCallback(
    (nextIndexes: number[]) => {
      const previousIndexes = selectedIndexesRef.current

      if (previousIndexes.length > 0 && nextIndexes.length === 0) {
        const historyIds = previousIndexes
          .sort((a, b) => a - b)
          .map(index => visibleClipboardHistoryRef.current[index])
          .filter(Boolean)
          .map(clipboard => String(clipboard.historyId))

        if (historyIds.length > 0) {
          selectedIndexesRef.current = []
          setSelectedIndexes([])

          pasteQueueRef.current = pasteQueueRef.current
            .catch(() => undefined)
            .then(() =>
              invoke('quickpaste_paste_many', {
                historyIds,
                separator: activePasteSequenceEachSeparator,
                prefixSeparator: false,
                closeAfter: false,
              })
            )

          return
        }
      }

      selectedIndexesRef.current = nextIndexes
      setSelectedIndexes(nextIndexes)
    },
    [activePasteSequenceEachSeparator]
  )

  const toggleSearchFocus = useCallback(async () => {
    if (document.activeElement === searchInputRef.current) {
      searchInputRef.current?.blur()
      invoke('set_quickpaste_search_active', { isActive: false })
      return
    }

    await appWindow.setFocus()
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    visibleClipboardHistoryRef.current = visibleClipboardHistory
  }, [visibleClipboardHistory])

  useEffect(() => {
    if (hasSearch) {
      refetchFindClipboardHistory()
    }
  }, [hasSearch, debouncedSearchTerm, refetchFindClipboardHistory])

  useEffect(() => {
    const unlisten = listen('quickpaste-show-search', () => {
      toggleSearchFocus()
    })

    return () => {
      unlisten.then(stopListening => stopListening())
    }
  }, [toggleSearchFocus])

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && (key === 'f' || key === 'k')) {
        event.preventDefault()
        toggleSearchFocus()
      }
    }

    window.addEventListener('keydown', handleHotkey)

    return () => {
      window.removeEventListener('keydown', handleHotkey)
    }
  }, [toggleSearchFocus])

  useEffect(() => {
    const handleMouseUp = () => {
      if (!isMouseSelectingRef.current) {
        return
      }

      isMouseSelectingRef.current = false
      updateSelectedIndexes([])
    }

    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [updateSelectedIndexes])

  useEffect(() => {
    let isDisposed = false

    const unlisten = listen<number[]>('quickpaste-selected-results', event => {
      if (isDisposed) {
        return
      }

      updateSelectedIndexes(event.payload)
    })

    return () => {
      isDisposed = true
      unlisten.then(stopListening => stopListening())
    }
  }, [updateSelectedIndexes])

  const loadMoreOnScroll = (event: UIEvent<HTMLElement>) => {
    setIsResultsScrolling(true)
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current)
    }
    scrollIdleTimerRef.current = setTimeout(() => {
      setIsResultsScrolling(false)
      scrollIdleTimerRef.current = null
    }, 650)

    if (isClipboardHistoryFetchingNextPage) {
      return
    }

    const target = event.currentTarget
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) {
      fetchNextClipboardHistoryPage()
    }
  }

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current)
      }
    }
  }, [])

  const focusSearchInput = () => {
    searchInputRef.current?.focus()
  }

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--quick-paste-highlight-color',
      activeAppearance.highlightColor
    )
    document.documentElement.style.setProperty(
      '--quick-paste-acrylic-color-depth',
      String(activeAppearance.acrylicColorDepth)
    )
    document.documentElement.style.setProperty(
      '--quick-paste-light-mask-color',
      activeAppearance.lightMaskColor
    )
    document.documentElement.style.setProperty(
      '--quick-paste-light-mask-strength',
      activeAppearance.maskEnabled ? String(activeAppearance.lightMaskStrength) : '0'
    )
    document.documentElement.style.setProperty(
      '--quick-paste-dark-mask-color',
      activeAppearance.darkMaskColor
    )
    document.documentElement.style.setProperty(
      '--quick-paste-dark-mask-strength',
      activeAppearance.maskEnabled ? String(activeAppearance.darkMaskStrength) : '0'
    )
    document.documentElement.style.setProperty(
      '--quick-paste-acrylic-opacity',
      String(activeAppearance.acrylicOpacity)
    )
    document.documentElement.style.setProperty(
      '--quick-paste-font-size',
      `${activeAppearance.fontSize}px`
    )
  }, [
    activeAppearance.acrylicColorDepth,
    activeAppearance.acrylicOpacity,
    activeAppearance.fontSize,
    activeAppearance.highlightColor,
    activeAppearance.lightMaskColor,
    activeAppearance.lightMaskStrength,
    activeAppearance.darkMaskColor,
    activeAppearance.darkMaskStrength,
    activeAppearance.maskEnabled,
  ])

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value)
  }

  const handleSearchFocus = () => {
    invoke('set_quickpaste_search_active', { isActive: true })
  }

  const handleSearchBlur = () => {
    invoke('set_quickpaste_search_active', { isActive: false })
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    void invoke('set_quickpaste_search_active', { isActive: false })
    searchInputRef.current?.blur()
    void invoke('restore_quickpaste_previous_focus')
  }

  const handleResultMouseDown = (index: number) => {
    isMouseSelectingRef.current = true
    updateSelectedIndexes([index])
  }

  const handleResultMouseUp = () => {
    if (!isMouseSelectingRef.current) {
      return
    }

    isMouseSelectingRef.current = false
    updateSelectedIndexes([])
  }

  return (
    <main className="flow-launcher-shell">
      <section className="flow-launcher-query-area" onMouseDown={focusSearchInput}>
        <input
          className="flow-launcher-query-input"
          onBlur={handleSearchBlur}
          onChange={handleSearchChange}
          onFocus={handleSearchFocus}
          onKeyDown={handleSearchKeyDown}
          placeholder="在此处输入以搜索"
          ref={searchInputRef}
          type="search"
          value={searchTerm}
        />
      </section>

      <div className="flow-launcher-separator" />

      <section
        className={`flow-launcher-results ${
          isResultsScrolling ? 'flow-launcher-results--scrolling' : ''
        }`}
        onScroll={loadMoreOnScroll}
      >
        {visibleClipboardHistory.map((clipboard, index) => {
          const imageSrc = clipboard.imagePathFullRes
            ? convertFileSrc(clipboard.imagePathFullRes)
            : clipboard.imageDataUrl
          const isSelected = selectedIndexSet.has(index)

          return (
            <div
              className={`flow-launcher-result-item ${
                clipboard.isImage && imageSrc ? 'flow-launcher-result-item-image' : ''
              } ${isSelected ? 'flow-launcher-result-item--selected' : ''}`}
              data-keyboard-selected={isSelected ? 'true' : 'false'}
              key={clipboard.historyId}
              onMouseDown={() => handleResultMouseDown(index)}
              onMouseUp={handleResultMouseUp}
            >
              <div className="flow-launcher-result-content">
                {clipboard.isImage && imageSrc ? (
                  <div className="flow-launcher-image-frame">
                    <img
                      className="flow-launcher-image"
                      decoding="async"
                      draggable={false}
                      src={imageSrc}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flow-launcher-result-title">{clipboard.value}</div>
                    <div className="flow-launcher-result-subtitle">
                      {clipboard.copiedFromApp}
                    </div>
                  </>
                )}
              </div>
              <div className="flow-launcher-hotkey">{index + 1}</div>
            </div>
          )
        })}
      </section>
    </main>
  )
}
