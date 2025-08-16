import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <div style={{maxWidth:720, margin:'40px auto', fontFamily:'system-ui, sans-serif'}}>
      <h1>Starter SPA</h1>
      <p>If you see this, your SPA skeleton is working.</p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
