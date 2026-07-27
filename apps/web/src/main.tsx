import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/ui/App'
import '@/ui/styles/tokens.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Élément racine #root introuvable dans index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
