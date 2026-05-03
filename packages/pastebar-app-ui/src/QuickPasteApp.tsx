import { useEffect } from 'react'

import FlowLauncherQuickPasteTestPage from './pages/main/FlowLauncherQuickPasteTestPage'

function QuickPasteApp() {
  useEffect(() => {
    document.documentElement.classList.add('quick-paste-document')
    document.body.classList.add('quick-paste-body')

    const preventContextMenu = (event: MouseEvent) => {
      if (!import.meta.env.TAURI_DEBUG) {
        event.preventDefault()
      }
    }

    window.addEventListener('contextmenu', preventContextMenu)

    return () => {
      document.documentElement.classList.remove('quick-paste-document')
      document.body.classList.remove('quick-paste-body')
      window.removeEventListener('contextmenu', preventContextMenu)
    }
  }, [])

  return <FlowLauncherQuickPasteTestPage />
}

export default QuickPasteApp
