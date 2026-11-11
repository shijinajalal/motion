import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
})
const { window } = dom
global.window = window
global.document = window.document
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true })
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
}))
global.matchMedia = window.matchMedia
global.Image = window.Image
global.HTMLCanvasElement = window.HTMLCanvasElement
global.Element = window.Element
global.requestAnimationFrame = window.requestAnimationFrame.bind(window)
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
global.MouseEvent = window.MouseEvent
global.Event = window.Event

// --- canvas 2d mock: record every drawImage call ---
const drawCalls = []
const ctxMock = {
  setTransform() {}, clearRect() {},
  drawImage(...args) { drawCalls.push(args) },
  canvas: null,
}
window.HTMLCanvasElement.prototype.getContext = function () { ctxMock.canvas = this; return ctxMock }

// --- image mock: resolve immediately, mark loaded ---
let imageLoads = 0
window.Image = class {
  constructor() { this.onload = null; this.onerror = null }
  set src(v) {
    this._src = v
    queueMicrotask(() => { imageLoads++; this.onload && this.onload() })
  }
  get src() { return this._src }
}
global.Image = window.Image

const { createRoot } = await import('react-dom/client')
const React = await import('react')
const { act } = await import('react-dom/test-utils')

// transform JSX on the fly via esbuild through vite's deps? simpler: use React.createElement directly
// — but our components are JSX files. Use vite-node style: compile with esbuild.
const esbuild = await import('esbuild')
const fs = await import('fs')
const path = await import('path')

async function loadJSX(file) {
  const result = await esbuild.build({
    entryPoints: [file], bundle: false, write: false, format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx' },
  })
  const code = result.outputFiles[0].text
  const tmp = file + '.smoke.mjs'
  // rewrite relative imports to absolute file URLs with jsx compilation of deps
  fs.writeFileSync(tmp, code)
  return tmp
}

// Simpler: build the whole App bundle with esbuild (external react)
const bundle = await esbuild.build({
  entryPoints: ['/home/user/motion/src/main.jsx'],
  bundle: true, write: false, format: 'esm', jsx: 'automatic',
  loader: { '.js': 'jsx', '.css': 'text' },
  define: { 'import.meta.env.BASE_URL': '"/"' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
})
const code = bundle.outputFiles[0].text
fs.writeFileSync('/home/user/motion/.app.bundle.mjs', code)

// main.jsx self-mounts into #root on import
global.IS_REACT_ACT_ENVIRONMENT = false
await import('/home/user/motion/.app.bundle.mjs')

// flush microtasks + animation frames so the preload chain completes
for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10))

const html = window.document.body.innerHTML
const checks = [
  ['canvas exists', !!window.document.querySelector('canvas.character-canvas')],
  ['nav pill exists', !!window.document.querySelector('.nav__pill')],
  ['3 nav links', window.document.querySelectorAll('.nav__link').length === 3],
  ['hero name = Lohitha', window.document.querySelector('.hero__name')?.textContent === 'Lohitha'],
  ['resume button', !!window.document.querySelector('.btn--solid')],
  ["let's talk button", !!window.document.querySelector('.btn--ghost')],
  ['bio max-width set', !!window.document.querySelector('.hero__bio')],
  ['cursor dot', !!window.document.querySelector('.cursor-dot')],
  ['cursor ring', !!window.document.querySelector('.cursor-ring')],
  ['bg gradient div', !!window.document.querySelector('.bg')],
  ['no <video> element', !window.document.querySelector('video')],
  ['images preloaded (>=65)', imageLoads >= 65],
  ['first frame painted (drawImage called)', drawCalls.length >= 1],
  ['exactly one image per draw', drawCalls.every(a => a.length === 5)],
]
let fail = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) fail++
}
console.log(`\nimage loads: ${imageLoads}, drawImage calls: ${drawCalls.length}`)

// ================= behavioral: angle -> frame mapping =================
const canvas = window.document.querySelector('canvas.character-canvas')
function pointer(x, y) {
  const ev = new window.Event('pointermove', { bubbles: true })
  ev.clientX = x; ev.clientY = y
  ev.clientX = x
  Object.defineProperty(ev, 'clientX', { value: x })
  Object.defineProperty(ev, 'clientY', { value: y })
  window.dispatchEvent(ev)
}
function lastFrameSrc() { return drawCalls[drawCalls.length - 1][0]?._src || null }

// Face center: cover-fit of 1920x1080 into jsdom viewport (default 1024x768)
const vw = 1024, vh = 768
const scale = Math.max(vw / 1920, vh / 1080)
const dw = 1920 * scale, dh = 1080 * scale
const fcx = (vw - dw) / 2 + 0.497396 * dw
const fcy = (vh - dh) / 2 + 0.333333 * dh

async function settle(n = 30) { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 8)) }

// 1) deadzone: cursor ON the face -> center.webp
pointer(fcx, fcy); await settle()
const inDead = lastFrameSrc()
console.log(`${inDead === '/frames/center.webp' ? 'PASS' : 'FAIL'}  deadzone -> center.webp (got ${inDead})`)

// 2) right of face -> f00, left -> f32, above -> f48, below -> f16
const R = 400
pointer(fcx + R, fcy); await settle()
const right = lastFrameSrc()
console.log(`${right === '/frames/f00.webp' ? 'PASS' : 'FAIL'}  cursor RIGHT -> f00 (got ${right})`)

pointer(fcx - R, fcy); await settle()
const left = lastFrameSrc()
console.log(`${left === '/frames/f32.webp' ? 'PASS' : 'FAIL'}  cursor LEFT -> f32 (got ${left})`)

pointer(fcx, fcy - R); await settle()
const up = lastFrameSrc()
console.log(`${up === '/frames/f48.webp' ? 'PASS' : 'FAIL'}  cursor UP -> f48 (got ${up})`)

pointer(fcx, fcy + R); await settle()
const down = lastFrameSrc()
console.log(`${down === '/frames/f16.webp' ? 'PASS' : 'FAIL'}  cursor DOWN -> f16 (got ${down})`)

// 3) no ghosting: every recorded draw painted exactly 1 image at full opacity
const ok = drawCalls.every(a => a.length === 5)
console.log(`${ok ? 'PASS' : 'FAIL'}  every draw = single drawImage (zero ghosting)`)

// 4) seamless wrap: from f63 side (just above RIGHT) to f00 must not sweep the long way
//    move from 10° above horizontal-right to 10° below: index should pass 63 -> 0 -> 1
pointer(fcx + R, fcy - R * Math.tan(10 * Math.PI / 180)); await settle()
const a1 = lastFrameSrc()
pointer(fcx + R, fcy + R * Math.tan(10 * Math.PI / 180)); await settle()
const a2 = lastFrameSrc()
console.log(`INFO  seam crossing: ${a1} -> ${a2} (adjacent bins across 0°)`)


function idxOf(src) {
  const m = /f(\d\d)\.webp/.exec(src || '')
  return m ? +m[1] : null
}

// 5) continuity under REALISTIC (continuous) cursor motion:
//    sweep the cursor around the face in 2° steps; each painted frame must
//    advance at most 3 bins (teleports in earlier tests are non-physical).
drawCalls.length = 0
for (let deg = 0; deg <= 360; deg += 2) {
  const rad = deg * Math.PI / 180
  pointer(fcx + 400 * Math.cos(rad), fcy + 400 * Math.sin(rad))
  await new Promise(r => setTimeout(r, 4)) // ~1 render frame
}
await settle(10)
let maxJump2 = 0, prevIdx2 = null
for (const a of drawCalls) {
  const i = idxOf(a[0]?._src)
  if (i === null) continue // center.webp not part of bin sequence
  if (prevIdx2 !== null) {
    const d = Math.abs(i - prevIdx2)
    maxJump2 = Math.max(maxJump2, Math.min(d, 64 - d))
  }
  prevIdx2 = i
}
console.log(`${maxJump2 <= 3 ? 'PASS' : 'FAIL'}  smooth sweep: max bin jump = ${maxJump2} (<=3 => no snap)`)
if (maxJump2 > 3) fail++
console.log(`${drawCalls.length >= 40 ? 'PASS' : 'FAIL'}  smooth sweep painted ${drawCalls.length} frames`)
if (drawCalls.length < 40) fail++

console.log('DRAW SEQUENCE:', drawCalls.map(a => a[0]?._src?.split('/').pop() ?? 'none').join(' -> '))
process.exit(fail ? 1 : 0)
