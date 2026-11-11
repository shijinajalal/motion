import { useEffect, useRef } from 'react'
import {
  FRAME_COUNT,
  VIDEO_SIZE,
  FACE_CENTER,
  BASE_FRAMES,
} from '../frameData.js'

const TAU = Math.PI * 2
const STEP = TAU / FRAME_COUNT // 5.625° per frame
const RESPONSE = 0.26 // angular lerp factor per 60fps frame (~35ms tracking)
const DEADZONE = 0.12 // cursor within 12% of screen diagonal => eye contact
const DPR_CAP = 2

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Shortest signed angular difference in [-π, π). */
function shortestAngle(from, to) {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

/** Frame-rate independent response: 0.26 per 16.67ms reference frame. */
function responseFor(dtMs) {
  return 1 - Math.pow(1 - RESPONSE, dtMs / (1000 / 60))
}

/**
 * Full-viewport canvas renderer.
 *
 * Zero-ghosting contract:
 *  - every rAF paints EXACTLY ONE pre-decoded frame at opacity 1
 *  - no alpha blending, no CSS 3D transforms, no video element at runtime
 *  - the page/body never moves; only the drawn head pose changes
 */
export default function CharacterCanvas({ onReady }) {
  const canvasRef = useRef(null)
  const framesRef = useRef(new Array(FRAME_COUNT).fill(null))
  const centerRef = useRef(null)
  const pointerRef = useRef({ x: 0, y: 0, active: false })
  const angleRef = useRef(null) // null until first pointer sample
  const sizeRef = useRef({ w: window.innerWidth, h: window.innerHeight })
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    const canvas = canvasRef.current
    // alpha:false -> opaque canvas: faster compositing, ghosting impossible.
    const ctx = canvas.getContext('2d', { alpha: false })
    let raf = 0
    let dead = false
    let painted = false
    let last = performance.now()

    // ---- sizing (cover metrics recomputed every draw) ----
    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      sizeRef.current = { w, h }
    }
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)

    // ---- pointer tracking (no React state: zero re-render lag) ----
    const onMove = (e) => {
      pointerRef.current.x = e.clientX
      pointerRef.current.y = e.clientY
      pointerRef.current.active = true
    }
    const onLeave = () => {
      pointerRef.current.active = false // pointer gone -> back to eye contact
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    // cross-browser "left the window" fallback (mouseout with no destination)
    const onWindowOut = (e) => {
      if (!e.relatedTarget && !e.toElement) onLeave()
    }
    window.addEventListener('mouseout', onWindowOut, { passive: true })
    window.addEventListener('blur', onLeave)

    // ---- render loop ----
    const draw = (img, w, h) => {
      // object-fit: cover for the 1920x1080 source
      const scale = Math.max(w / VIDEO_SIZE.w, h / VIDEO_SIZE.h)
      const dw = VIDEO_SIZE.w * scale
      const dh = VIDEO_SIZE.h * scale
      const ox = (w - dw) / 2
      const oy = (h - dh) / 2
      ctx.clearRect(0, 0, w, h) // wipe, then paint ONE frame at full opacity
      ctx.drawImage(img, ox, oy, dw, dh)
      return { ox, oy, dw, dh }
    }

    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(t - last, 64) // clamp after tab switches
      last = t
      const { w, h } = sizeRef.current
      const center = centerRef.current
      if (!center) return

      // face centre on screen under cover-fit
      const scale = Math.max(w / VIDEO_SIZE.w, h / VIDEO_SIZE.h)
      const dw = VIDEO_SIZE.w * scale
      const dh = VIDEO_SIZE.h * scale
      const fcx = (w - dw) / 2 + FACE_CENTER.nx * dw
      const fcy = (h - dh) / 2 + FACE_CENTER.ny * dh

      const p = pointerRef.current
      let useCenter = !p.active
      if (p.active) {
        const dx = p.x - fcx
        const dy = p.y - fcy
        const dist = Math.hypot(dx, dy)
        // deadzone: cursor near the face -> she looks into your eyes
        useCenter = dist < DEADZONE * Math.hypot(w, h)
        // smooth the angle along the shortest arc, even inside the deadzone,
        // so exiting it lands on the correct pose with no swoop.
        const target = Math.atan2(dy, dx)
        const prev = angleRef.current
        angleRef.current =
          prev === null
            ? target // first sample: snap, no artificial spin-in
            : prev + shortestAngle(prev, target) * responseFor(dt)
      }

      let img = center
      if (!useCenter && angleRef.current !== null) {
        const a = ((angleRef.current % TAU) + TAU) % TAU
        const idx = Math.round(a / STEP) % FRAME_COUNT
        img = framesRef.current[idx] || center // fallback while streaming in
      }

      // EXACTLY ONE frame, 100% opacity — no blending of any kind.
      draw(img, w, h)
      if (!painted) {
        painted = true
        canvas.classList.add('is-painted') // fade canvas in after first real frame
      }
    }

    // ---- preload: center first (instant eye contact), then the 64 poses ----
    ;(async () => {
      const center = await loadImage(`${BASE_FRAMES}center.webp`)
      if (dead) return
      centerRef.current = center
      if (center) {
        raf = requestAnimationFrame(loop)
      }
      // Reveal the UI even if the image 404s — text must never be trapped
      // behind a loading state. Canvas fades in only after its first paint
      // (see `is-painted`), so a black buffer can never flash.
      onReadyRef.current?.()

      const imgs = await Promise.all(
        Array.from({ length: FRAME_COUNT }, (_, i) =>
          loadImage(`${BASE_FRAMES}f${String(i).padStart(2, '0')}.webp`)
        )
      )
      if (dead) return
      imgs.forEach((im, i) => {
        if (im) framesRef.current[i] = im
      })
    })()

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('mouseout', onWindowOut)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="character-canvas"
      role="img"
      aria-label="Character portrait tracking your cursor"
    />
  )
}
