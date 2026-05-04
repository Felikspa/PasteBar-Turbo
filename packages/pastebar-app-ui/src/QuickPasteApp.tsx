import { useEffect, useState } from 'react'

import { appSettings } from './lib/commands'
import QuickPastePage, { QuickPasteAppearance } from './pages/main/QuickPastePage'

const defaultQuickPasteAppearance: QuickPasteAppearance = {
  acrylicColorDepth: 95,
  acrylicOpacity: 25,
  maskEnabled: false,
  fontSize: 16,
  highlightColor: '#2563eb',
  lightMaskColor: '#ffffff',
  lightMaskStrength: 72,
  darkMaskColor: '#000000',
  darkMaskStrength: 72,
}

function QuickPasteApp() {
  const [appearance, setAppearance] = useState<QuickPasteAppearance>(
    defaultQuickPasteAppearance
  )
  const [pasteSequenceEachSeparator, setPasteSequenceEachSeparator] = useState<
    string | null
  >(null)

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
      const opacity = settings.quickPasteAcrylicOpacity?.valueInt ?? 25
      const colorDepth = settings.quickPasteAcrylicColorDepth?.valueInt ?? 95
      const maskEnabled = settings.quickPasteMaskEnabled?.valueBool ?? false
      const lightMaskColor = settings.quickPasteLightMaskColor?.valueText ?? '#ffffff'
      const lightMaskStrength = settings.quickPasteLightMaskStrength?.valueInt ?? 72
      const darkMaskColor = settings.quickPasteDarkMaskColor?.valueText ?? '#000000'
      const darkMaskStrength = settings.quickPasteDarkMaskStrength?.valueInt ?? 72
      const fontSize = settings.quickPasteFontSize?.valueInt ?? 16
      const highlightColor = settings.quickPasteHighlightColor?.valueText ?? '#2563eb'
      const separator = settings.pasteSequenceEachSeparator?.valueText ?? '\n'
      const nextAppearance = {
        acrylicColorDepth: colorDepth,
        acrylicOpacity: opacity,
        maskEnabled,
        fontSize,
        highlightColor,
        lightMaskColor,
        lightMaskStrength,
        darkMaskColor,
        darkMaskStrength,
      }

      setAppearance(nextAppearance)
      setPasteSequenceEachSeparator(separator)

      document.documentElement.style.setProperty(
        '--quick-paste-acrylic-opacity',
        String(nextAppearance.acrylicOpacity)
      )
      document.documentElement.style.setProperty(
        '--quick-paste-acrylic-color-depth',
        String(nextAppearance.acrylicColorDepth)
      )
      document.documentElement.style.setProperty(
        '--quick-paste-light-mask-color',
        nextAppearance.lightMaskColor
      )
      document.documentElement.style.setProperty(
        '--quick-paste-light-mask-strength',
        nextAppearance.maskEnabled ? String(nextAppearance.lightMaskStrength) : '0'
      )
      document.documentElement.style.setProperty(
        '--quick-paste-dark-mask-color',
        nextAppearance.darkMaskColor
      )
      document.documentElement.style.setProperty(
        '--quick-paste-dark-mask-strength',
        nextAppearance.maskEnabled ? String(nextAppearance.darkMaskStrength) : '0'
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

  if (pasteSequenceEachSeparator === null) {
    return null
  }

  return (
    <QuickPastePage
      appearance={appearance}
      pasteSequenceEachSeparator={pasteSequenceEachSeparator}
    />
  )
}

export default QuickPasteApp
