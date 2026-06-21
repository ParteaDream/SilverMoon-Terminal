import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { DbProvider } from './context/DbContext'
import { NavProvider } from './context/NavContext'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <DbProvider>
        <NavProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </NavProvider>
      </DbProvider>
    </HashRouter>
  </React.StrictMode>
)
