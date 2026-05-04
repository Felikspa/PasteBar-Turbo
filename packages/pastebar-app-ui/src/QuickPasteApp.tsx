import { useEffect, useState } from 'react'

import { appSettings } from './lib/commands'
import QuickPastePage, { QuickPasteAppearance } from './pages/main/QuickPastePage'

const defaultQuickPasteAppearance: QuickPasteAppearance = {
  acrylicColorDepth: 100,
  acrylicOpacity: 86,
  maskEnabled: true,
  fontSize: 16,
  highlightColor: '#2563eb',
  maskStrength: 72,
}

function QuickPasteApp() {
  const [appearance, setAppearance] = useState<QuickPasteAppearance>(
    defaultQuickPasteAppearance
  )

  useEffect(() => {
    document.documentElement.classList.add('quick-paste-document')
    document.body.classList.add('quick-paste-body')

    const preventContextMenu = (event: MouseEvent) => {
      if (!import.meta.env.TAURI_DEBUG) {
        event.preventDefault()
      }
    }

    window.addEventListener('contextmenu', preventContextMenu)

    void appSettings().then(res => {
      if (!res) {
        return
      }

      const { settings } = JSON.parse(res)
      const opacity = settings.quickPasteAcrylicOpacity?.valueInt ?? 86
      const colorDepth = settings.quickPasteAcrylicColorDepth?.valueInt ?? 100
      const maskEnabled = settings.quickPasteMaskEnabled?.valueBool ?? true
      const maskStrength = settings.quickPasteMaskStrength?.valueInt ?? 72
      const fontSize = settings.quickPasteFontSize?.valueInt ?? 16
      const highlightColor = settings.quickPasteHighlightColor?.valueText ?? '#2563eb'
      const nextAppearance = {
        acrylicColorDepth: colorDepth,
        acrylicOpacity: opacity,
        maskEnabled,
        fontSize,
        highlightColor,
        maskStrength,
      }

      setAppearance(nextAppearance)

      document.documentElement.style.setProperty(
        '--quick-paste-acrylic-opacity',
        String(nextAppearance.acrylicOpacity)
      )
      document.documentElement.style.setProperty(
        '--quick-paste-acrylic-color-depth',
        String(nextAppearance.acrylicColorDepth)
      )
      document.documentElement.style.setProperty(
        '--quick-paste-mask-strength',
        nextAppearance.maskEnabled ? String(nextAppearance.maskStrength) : '0'
      )
      document.documentElement.style.setProperty(
        '--quick-paste-font-size',
        `${nextAppearance.fontSize}px`
      )
      document.documentElement.style.setProperty(
        '--quick-paste-highlight-color',
        nextAppearance.highlightColor
      )
    })

    return () => {
      document.documentElement.classList.remove('quick-paste-document')
      document.body.classList.remove('quick-paste-body')
      window.removeEventListener('contextmenu', preventContextMenu)
    }
  }, [])

  return <QuickPastePage appearance={appearance} />
}

export default QuickPasteApp
