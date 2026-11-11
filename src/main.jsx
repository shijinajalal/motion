import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/dancing-script/500.css'
import '@fontsource/dancing-script/600.css'
import '@fontsource/dancing-script/700.css'
import './styles.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
