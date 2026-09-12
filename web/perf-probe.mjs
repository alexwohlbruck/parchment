// Perf probe v2: main-thread-focused measurement of idle + sheet-drag cost.
// Software GL makes absolute FPS meaningless here, so we measure the
// hardware-independent signals: repaint requests, camera calls per drag,
// forced layout/style-recalc counts, script CPU time, long tasks.
// Run from web/: node perf-probe.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'

const SID = 'perf343d15fc3829fded6ea7ce14f68b45bd'
const HOST = 'vega5.tailc47d6.ts.net'
const URL = `https://${HOST}:8400/`

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${HOST} 100.70.133.121`],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  ignoreHTTPSErrors: true,
})
await context.addCookies([
  { name: 'auth_session', value: SID, domain: HOST, path: '/', secure: true },
])
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')

async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0
  return {
    task: get('TaskDuration'),
    script: get('ScriptDuration'),
    layoutCount: get('LayoutCount'),
    styleCount: get('RecalcStyleCount'),
  }
}

const results = { runs: [] }

async function loadWithConfig(buildings3d, transit, firstLoad) {
  if (firstLoad) {
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(4000)
  }
  await page.evaluate(
    ([b, t]) => {
      const m = JSON.parse(localStorage.getItem('map') || '{}')
      m.engine = 'maplibre'
      m.buildings3d = b
      m.projection = 'mercator'
      localStorage.setItem('map', JSON.stringify(m))
      const vis = JSON.parse(localStorage.getItem('parchment-group-visibility') || '{}')
      vis['default:group:transit'] = t
      localStorage.setItem('parchment-group-visibility', JSON.stringify(vis))
      localStorage.setItem(
        'map-camera',
        JSON.stringify({ center: { lng: -73.9857, lat: 40.7484 }, zoom: 15.8, bearing: 0, pitch: 55 }),
      )
    },
    [buildings3d, transit],
  )
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const close = document.querySelector('button[aria-label="Close"]')
    if (close) close.click()
  }).catch(() => {})
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !!window.__parchmentMap, null, { timeout: 90000 })
  // settle: let tiles/portolan mount
  await page.waitForTimeout(15000)
  await page.evaluate(() => {
    const map = window.__parchmentMap
    const P = (window.__perf = {})
    P.counters = {}
    P.repaintStacks = {}
    const wrap = (name) => {
      const orig = map[name].bind(map)
      P.counters[name] = 0
      map[name] = (...a) => {
        P.counters[name]++
        if (name === 'triggerRepaint') {
          const s = (new Error().stack || '').split('\n').slice(2, 5).join(' | ')
          P.repaintStacks[s] = (P.repaintStacks[s] || 0) + 1
        }
        return orig(...a)
      }
    }
    ;['easeTo', 'flyTo', 'jumpTo', 'panBy', 'setCenter', 'setPadding', 'triggerRepaint', 'resize'].forEach(wrap)
    P.renderCount = 0
    map.on('render', () => P.renderCount++)
    P.start = () => {
      P.t0 = performance.now()
      P.snap0 = { ...P.counters }
      P.render0 = P.renderCount
      P.rafCount = 0
      P.longTasks = []
      P.po = new PerformanceObserver((l) => l.getEntries().forEach((e) => P.longTasks.push(Math.round(e.duration))))
      P.po.observe({ entryTypes: ['longtask'] })
      P.running = true
      const tick = () => {
        P.rafCount++
        if (P.running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    P.stop = () => {
      P.running = false
      P.po.disconnect()
      const dur = performance.now() - P.t0
      const camera = {}
      for (const k in P.counters) {
        const d = P.counters[k] - P.snap0[k]
        if (d) camera[k] = d
      }
      return { durMs: Math.round(dur), rafFrames: P.rafCount, renders: P.renderCount - P.render0, camera, longTasks: P.longTasks.length, longTaskTotalMs: P.longTasks.reduce((a, b) => a + b, 0) }
    }
    const style = map.getStyle()
    const byType = {}
    let portolan = 0
    for (const l of style.layers) {
      byType[l.type] = (byType[l.type] || 0) + 1
      if (l.id.startsWith('portolan')) portolan++
    }
    const portolanSources = Object.keys(style.sources).filter((s) => s.startsWith('portolan')).length
    P.census = { layers: style.layers.length, byType, portolan, portolanSources, sources: Object.keys(style.sources).length, zoom: Math.round(map.getZoom() * 100) / 100, pitch: map.getPitch() }
  })
  return page.evaluate(() => window.__perf.census)
}

// Trusted-input drag via CDP mouse events on the drawer grab area.
async function dragInPage(dyTotal, steps = 40) {
  const r = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-vaul-drawer]')
    const el = els[els.length - 1]
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: b.top }
  })
  if (!r) return { error: 'no drawer' }
  const x = 195
  const y0 = Math.min(Math.max(r.top + 20, 30), 820)
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y0 + (dyTotal * i) / steps)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  const after = await page.evaluate(() => {
    const els = document.querySelectorAll('[data-vaul-drawer]')
    const el = els[els.length - 1]
    return el ? el.getBoundingClientRect().top : null
  })
  return { from: y0, to: y0 + dyTotal, top0: r.top, topAfter: after }
}

async function measure(label, fn) {
  const m0 = await metrics()
  await page.evaluate(() => window.__perf.start())
  const extra = await fn()
  const m = await page.evaluate(() => window.__perf.stop())
  const m1 = await metrics()
  m.cpu = {
    taskMs: Math.round((m1.task - m0.task) * 1000),
    scriptMs: Math.round((m1.script - m0.script) * 1000),
    layouts: Math.round(m1.layoutCount - m0.layoutCount),
    styleRecalcs: Math.round(m1.styleCount - m0.styleCount),
  }
  m.label = label
  if (extra) m.extra = extra
  console.error(label, JSON.stringify(m))
  return m
}

const configs = [
  { name: '3D+transit', b: true, t: true },
  { name: 'no3D+transit', b: false, t: true },
  { name: '3D+noTransit', b: true, t: false },
  { name: 'no3D+noTransit', b: false, t: false },
]

let first = true
for (const c of configs) {
  console.error('=== config', c.name)
  const census = await loadWithConfig(c.b, c.t, first)
  first = false
  console.error('census', JSON.stringify(census))
  const idle = await measure(`${c.name}/idle`, () => page.waitForTimeout(6000))
  const repaintStacks = await page.evaluate(() => {
    const top = Object.entries(window.__perf.repaintStacks).sort((a, b) => b[1] - a[1]).slice(0, 4)
    window.__perf.repaintStacks = {}
    return top
  })
  const up = await measure(`${c.name}/dragUp`, () => dragInPage(-560, 45))
  await page.waitForTimeout(1200)
  const down = await measure(`${c.name}/dragDown`, () => dragInPage(560, 45))
  await page.waitForTimeout(800)
  results.runs.push({ config: c.name, census, idle, repaintStacks, up, down })
}

await page.screenshot({ path: '/tmp/perf-probe-final.png' })
fs.writeFileSync('/tmp/perf-probe-results.json', JSON.stringify(results, null, 2))
console.error('DONE')
await browser.close()
