import { UIEvent, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri'
import { useAtomValue } from 'jotai'

import { useInfiniteClipboardHistory } from '~/hooks/queries/use-history-items'

import { clipboardHistoryStoreAtom } from '~/store/clipboardHistoryStore'

export default function FlowLauncherQuickPasteTestPage() {
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  const selectedIndexesRef = useRef<number[]>([])

  const { fetchNextClipboardHistoryPage, isClipboardHistoryFetchingNextPage } =
    useInfiniteClipboardHistory()

  const { clipboardHistory } = useAtomValue(clipboardHistoryStoreAtom)
  const clipboardHistoryRef = useRef(clipboardHistory)

  useEffect(() => {
    clipboardHistoryRef.current = clipboardHistory
  }, [clipboardHistory])

  useEffect(() => {
    let isDisposed = false

    const unlisten = listen<number[]>('quickpaste-selected-results', event => {
      const previousIndexes = selectedIndexesRef.current
      const nextIndexes = event.payload

      if (previousIndexes.length > 0 && nextIndexes.length === 0) {
        const historyIds = previousIndexes
          .sort((a, b) => a - b)
          .map(index => String(clipboardHistoryRef.current[index].historyId))

        if (historyIds.length > 0) {
          invoke('quickpaste_paste_many', {
            historyIds,
            separator: '\n',
            prefixSeparator: false,
            closeAfter: false,
          }).finally(() => {
            if (isDisposed) {
              return
            }

            selectedIndexesRef.current = []
            setSelectedIndexes([])
          })

          return
        }
      }

      selectedIndexesRef.current = nextIndexes
      setSelectedIndexes(nextIndexes)
    })

    return () => {
      isDisposed = true
      unlisten.then(stopListening => stopListening())
    }
  }, [])

  const loadMoreOnScroll = (event: UIEvent<HTMLElement>) => {
    if (isClipboardHistoryFetchingNextPage) {
      return
    }

    const target = event.currentTarget
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) {
      fetchNextClipboardHistoryPage()
    }
  }

  return (
    <main className="flow-launcher-shell">
      <section className="flow-launcher-query-area">
        <input
          className="flow-launcher-query-input"
          placeholder="在此处输入以搜索"
          type="search"
        />
      </section>

      <div className="flow-launcher-separator" />

      <section className="flow-launcher-results" onScroll={loadMoreOnScroll}>
        {clipboardHistory.map((clipboard, index) => {
          const imageSrc = clipboard.imagePathFullRes
            ? convertFileSrc(clipboard.imagePathFullRes)
            : clipboard.imageDataUrl
          const isSelected = selectedIndexes.includes(index)

          return (
            <div
              className={`flow-launcher-result-item ${
                clipboard.isImage && imageSrc ? 'flow-launcher-result-item-image' : ''
              } ${isSelected ? 'flow-launcher-result-item--selected' : ''}`}
              data-keyboard-selected={isSelected ? 'true' : 'false'}
              key={clipboard.historyId}
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
                    <div className="flow-launcher-result-title">
                      {clipboard.value}
                    </div>
                    <div className="flow-launcher-result-subtitle">
                      {clipboard.copiedFromApp}
                    </div>
                  </>
                )}
              </div>
              <div className="flow-launcher-hotkey">
                {index + 1}
              </div>
            </div>
          )
        })}
      </section>
    </main>
  )
}
