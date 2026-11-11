import { useEffect, useRef } from 'react'

const DOT_EASE = 0.35 // dot: near-instant but smoothed
const RING_EASE = 0.14 // aura ring: elegant trailing lag
const SCALE_EASE = 0.16 // hover scale eased in the same rAF (see note below)
const MAGNET_RADIUS = 60 // px — pull strength starts this close
const MAGNET_PULL = 0.32
const HOVER_SCALE = 1.75

// NOTE: position and scale must live in ONE transform string. A separate CSS
// `scale:` property would multiply with our translate3d matrix and displace
// the cursor on hover, so scale is composed here instead.

function closestInteractive(el) {
  if (!el || !(el instanceof Element)) return null
  return el.closest('a, button, [data-cursor]')
}

/**
 * Glowing white dot + trailing aura ring.
 * - both are position-smoothed in one rAF loop (no layout thrash)
 * - ring scales up over interactive elements
 * - magnetic pull: the dot leans toward the hovered element's centre
 */
export default function Cursor() {
  const dotRef = useRef(null)
  const ringRef = useRef(null)

  useEffect(() => {
    // Only take over on precise pointers; touch devices keep native behaviour.
    if (!window.matchMedia('(pointer: fine)').matches) return
    document.documentElement.classList.add('has-custom-cursor')

    const dot = dotRef.current
    const ring = ringRef.current
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const pos = { x: target.x, y: target.y }
    const ringPos = { x: target.x, y: target.y }
    let dotScale = 1
    let ringScale = 1
    let hoverEl = null
    let magnet = { x: 0, y: 0 }
    let raf = 0

    const setHover = (el) => {
      if (el === hoverEl) return
      hoverEl = el
      dot.classList.toggle('is-hover', !!el)
      ring.classList.toggle('is-hover', !!el)
    }

    const onMove = (e) => {
      target.x = e.clientX
      target.y = e.clientY
      setHover(closestInteractive(e.target))
      // any movement proves the pointer is present (covers browsers where
      // pointerenter on window is unreliable after an alt-tab)
      if (dot.style.opacity === '0') onEnter()
    }

    const onOverOut = (e) => {
      // delegated: works for elements entering/leaving under the pointer
      if (e.type === 'pointerover') {
        setHover(closestInteractive(e.target))
      } else if (e.type === 'pointerout' && !e.relatedTarget) {
        setHover(null) // pointer left the window entirely
      }
    }

    const onLeave = () => {
      setHover(null)
      dot.style.opacity = '0'
      ring.style.opacity = '0'
    }

    const onEnter = () => {
      dot.style.opacity = '1'
      ring.style.opacity = '1'
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)

      // magnetic lean toward hovered element centre
      let tx = target.x
      let ty = target.y
      if (hoverEl) {
        const r = hoverEl.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const d = Math.hypot(cx - target.x, cy - target.y)
        const reach = Math.max(r.width, r.height) / 2 + MAGNET_RADIUS
        if (d < reach) {
          const s = (1 - d / reach) * MAGNET_PULL
          magnet.x += (cx - target.x) * s - magnet.x * 0.2
          magnet.y += (cy - target.y) * s - magnet.y * 0.2
        } else {
          magnet.x *= 0.85
          magnet.y *= 0.85
        }
      } else {
        magnet.x *= 0.85
        magnet.y *= 0.85
      }
      tx += magnet.x
      ty += magnet.y

      pos.x += (tx - pos.x) * DOT_EASE
      pos.y += (ty - pos.y) * DOT_EASE
      ringPos.x += (tx - ringPos.x) * RING_EASE
      ringPos.y += (ty - ringPos.y) * RING_EASE

      // eased hover scale, composed into the same transform string
      const dotGoal = hoverEl ? HOVER_SCALE : 1
      const ringGoal = hoverEl ? HOVER_SCALE : 1
      dotScale += (dotGoal - dotScale) * SCALE_EASE
      ringScale += (ringGoal - ringScale) * SCALE_EASE

      dot.style.transform =
        `translate3d(${pos.x}px, ${pos.y}px, 0) ` +
        `translate(-50%, -50%) scale(${dotScale.toFixed(4)})`
      ring.style.transform =
        `translate3d(${ringPos.x}px, ${ringPos.y}px, 0) ` +
        `translate(-50%, -50%) scale(${ringScale.toFixed(4)})`
    }
    raf = requestAnimationFrame(loop)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerenter', onEnter)
    document.addEventListener('pointerover', onOverOut, { passive: true })
    document.addEventListener('pointerout', onOverOut, { passive: true })
    // reliable "left the window" detection across browsers
    window.addEventListener('mouseout', onLeaveWindow, { passive: true })
    window.addEventListener('blur', onLeave)
    window.addEventListener('focus', onEnter)

    function onLeaveWindow(e) {
      if (!e.relatedTarget && !e.toElement) onLeave()
    }

    return () => {
      cancelAnimationFrame(raf)
      document.documentElement.classList.remove('has-custom-cursor')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerenter', onEnter)
      document.removeEventListener('pointerover', onOverOut)
      document.removeEventListener('pointerout', onOverOut)
      window.removeEventListener('mouseout', onLeaveWindow)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('focus', onEnter)
    }
  }, [])

  return (
    <>
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
    </>
  )
}
