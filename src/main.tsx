import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/contexts/AuthContext'
import { App } from '@/App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            style: {
              borderRadius: '16px',
              border: '1px solid #EAECF0',
              fontFamily: 'Inter Variable, Inter, sans-serif'
            }
          }}
        />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
