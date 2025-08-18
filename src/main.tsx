import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { initAuth } from './lib/auth'

// Initialize auth on load (handles redirect callback)
initAuth().finally(() => {
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
})
