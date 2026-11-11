import { useState } from 'react'
import { BACKGROUND } from './frameData.js'
import CharacterCanvas from './components/CharacterCanvas.jsx'
import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import Cursor from './components/Cursor.jsx'

export default function App() {
  const [ready, setReady] = useState(false)

  return (
    <div className={`app${ready ? ' is-ready' : ''}`}>
      {/* Page background: exact radial gradient sampled from the video */}
      <div className="bg" style={{ background: BACKGROUND.css }} aria-hidden="true" />

      {/* Full-viewport canvas — the character, cover-fitted, rock solid */}
      <CharacterCanvas onReady={() => setReady(true)} />

      {/* Legibility scrim for the bottom-left typography (static, no motion) */}
      <div className="scrim" aria-hidden="true" />

      <Nav />
      <Hero />
      <Cursor />
    </div>
  )
}
