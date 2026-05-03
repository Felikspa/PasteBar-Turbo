import { useEffect } from 'react'

import QuickPastePage from './pages/main/QuickPastePage'

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

  return <QuickPastePage />
}

export default QuickPasteApp
