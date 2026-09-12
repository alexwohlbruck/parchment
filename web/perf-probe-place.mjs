// Focused probe: open a place sheet, drag it, count camera calls per frame.
import { chromium } from 'playwright'

const SID = 'perf343d15fc3829fded6ea7ce14f68b45bd'
const HOST = 'vega5.tailc47d6.ts.net'
const URL = `https://${HOST}:8400/`

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 100.70.133.121`] })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  ignoreHTTPSErrors: true,
})
await context.addCookies([{ name: 'auth_session', value: SID, domain: HOST, path: '/', secure: true }])
const page = await context.newPage()

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('map') || '{}')
  m.engine = 'maplibre'
  m.buildings3d = false // keep renders cheap; we are measuring the camera call path
  m.projection = 'mercator'
  localStorage.setItem('map', JSON.stringify(m))
  const vis = JSON.parse(localStorage.getItem('parchment-group-visibility') || '{}')
  vis['default:group:transit'] = false
  localStorage.setItem('parchment-group-visibility', JSON.stringify(vis))
  localStorage.setItem('map-camera', JSON.stringify({ center: { lng: -73.9857, lat: 40.7484 }, zoom: 15.8, bearing: 0, pitch: 0 }))
})
await page.reload({ waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(2500)
await page.evaluate(() => document.querySelector('button[aria-label="Close"]')?.click()).catch(() => {})
await page.waitForFunction(() => !!window.__parchmentMap, null, { timeout: 90000 })
await page.waitForTimeout(6000)

// Instrument camera calls + vaul drag events.
await page.evaluate(() => {
  const map = window.__parchmentMap
  const P = (window.__perf = { counters: {}, log: [] })
  const wrap = (name) => {
    const orig = map[name].bind(map)
    P.counters[name] = 0
    map[name] = (...a) => {
      P.counters[name]++
      return orig(...a)
    }
  }
  ;['easeTo', 'flyTo', 'jumpTo', 'panBy', 'setCenter', 'setPadding', 'triggerRepaint'].forEach(wrap)
  P.renderCount = 0
  map.on('render', () => P.renderCount++)
  P.snap = () => JSON.parse(JSON.stringify({ counters: P.counters, renders: P.renderCount }))
})

// Open a place through search.
console.error('searching...')
await page.locator('input').first().click()
await page.keyboard.type('Bryant Park', { delay: 50 })
await page.waitForTimeout(9000)
const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('div.cursor-pointer')].slice(0, 8).map((e) => e.textContent.trim().slice(0, 60))
})
console.error('rows:', JSON.stringify(rows))
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.cursor-pointer')]
  const hit = rows.find((r) => /bryant park/i.test(r.textContent))
  if (hit) {
    hit.click()
    return hit.textContent.trim().slice(0, 60)
  }
  return null
})
console.error('clicked:', clicked)
await page.waitForTimeout(5000)
console.error('url:', page.url())

const sheetTop = await page.evaluate(() => {
  const els = document.querySelectorAll('[data-vaul-drawer]')
  const el = els[els.length - 1]
  return el ? el.getBoundingClientRect().top : null
})
console.error('sheet top:', sheetTop)

async function drag(y0, y1, steps = 40) {
  const x = 195
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y0 + ((y1 - y0) * i) / steps)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

async function measureDrag(label, y0, y1) {
  const before = await page.evaluate(() => window.__perf.snap())
  const center0 = await page.evaluate(() => ({ c: window.__parchmentMap.getCenter(), p: window.__parchmentMap.getPadding() }))
  await drag(y0, y1)
  await page.waitForTimeout(1500)
  const after = await page.evaluate(() => window.__perf.snap())
  const center1 = await page.evaluate(() => ({ c: window.__parchmentMap.getCenter(), p: window.__parchmentMap.getPadding() }))
  const delta = {}
  for (const k in after.counters) {
    const d = after.counters[k] - before.counters[k]
    if (d) delta[k] = d
  }
  console.error(label, JSON.stringify({ delta, renders: after.renders - before.renders, pad0: center0.p, pad1: center1.p }))
}

// Drag the place sheet up from its header, then back down.
const grabY = Math.min(Math.max((sheetTop ?? 700) + 20, 30), 820)
await measureDrag('placeDragUp', grabY, 120)
const top2 = await page.evaluate(() => {
  const els = document.querySelectorAll('[data-vaul-drawer]')
  const el = els[els.length - 1]
  return el ? el.getBoundingClientRect().top : null
})
console.error('sheet top after up:', top2)
await measureDrag('placeDragDown', Math.min(Math.max((top2 ?? 100) + 20, 30), 820), 700)

await page.screenshot({ path: '/tmp/perf-place-final.png' })
console.error('DONE')
await browser.close()
