import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'

const url = process.env.BENCH_URL
const state = process.env.BENCH_STORAGE_STATE
if (!url || !state) throw new Error('Set BENCH_URL and BENCH_STORAGE_STATE to an authenticated preview and Playwright storage state')
const output = process.env.BENCH_OUTPUT || 'map-rendering.json'
const browser = await chromium.launch({ args: JSON.parse(process.env.BENCH_BROWSER_ARGS || '[]') })
const results = { runs: [], environment: {}, errors: [] }
const configurations = [
  { name: 'base', transit: false, cycling: false, terrain: false },
  { name: 'transit', transit: true, cycling: false, terrain: false },
  { name: 'cycling', transit: false, cycling: true, terrain: false },
  { name: 'combined', transit: true, cycling: true, terrain: false },
  { name: 'terrain', transit: true, cycling: true, terrain: true },
]
const camera = process.env.BENCH_CAMERA ? JSON.parse(process.env.BENCH_CAMERA) : { center: [-73.984, 40.7549], zoom: 15.5, pitch: 55, bearing: 20 }
try {
  const context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'block' })
  await context.addInitScript(origin => {
    if (!origin) return
    localStorage.setItem('parchment-selected-server', origin)
    localStorage.setItem('parchment-default-server', origin)
  }, process.env.BENCH_API_URL)
  const page = await context.newPage()
  page.on('pageerror', error => results.errors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => !!window.__map, null, { timeout: 90000 })
  await page.waitForTimeout(5000)
  for (const dialog of await page.getByRole('dialog').all()) {
    await dialog.getByRole('button', { name: /cancel|close|not now/i }).first().click({ timeout: 1500 }).catch(() => {})
  }
  await page.evaluate(async () => {
    const { useMapStore } = await import('/src/stores/map.store.ts')
    const { useLayersStore } = await import('/src/stores/layers.store.ts')
    const { useLayerVisibilityService } = await import('/src/services/layers/core/layer-visibility.service.ts')
    const mapStore = useMapStore(), layers = useLayersStore(), service = useLayerVisibilityService()
    window.__benchConfig = config => {
      Object.assign(mapStore.settings, { terrain3d: config.terrain, buildings3d: true, objects3d: true, hdRoads: true })
      for (const name of ['transit', 'cycling']) {
        const group = layers.allLayerGroups.find(g => g.id === `default:group:${name}`)
        if (!group) throw new Error(`Missing ${name} group`)
        service.toggleLayerGroupVisibility(group, config[name], layers, layers.layers, mapStore.getMapStrategy(), layers.allLayerGroups)
      }
    }
    const map = window.__map
    const data = window.__bench = { frames: [], renders: [], longTasks: [], calls: {}, active: false }
    const observer = new PerformanceObserver(list => { if (data.active) data.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))) })
    observer.observe({ type: 'longtask' })
    const original = map._render
    map._render = function (...args) {
      const start = performance.now()
      try { return original.apply(this, args) } finally { if (data.active) data.renders.push(performance.now() - start) }
    }
    for (const name of ['querySourceFeatures', 'queryRenderedFeatures', 'setData', 'setFilter', 'setLayoutProperty']) {
      if (typeof map[name] !== 'function') continue
      const original = map[name]
      map[name] = function (...args) {
        if (!data.active) return original.apply(this, args)
        const start = performance.now()
        try { return original.apply(this, args) } finally {
          const key = `${name}:${typeof args[0] === 'string' ? args[0] : ''}`
          const entry = data.calls[key] ||= { count: 0, ms: 0, max: 0 }
          const duration = performance.now() - start
          entry.count++; entry.ms += duration; entry.max = Math.max(entry.max, duration)
        }
      }
    }
    let last = 0
    function frame(time) { if (data.active && last) data.frames.push(time - last); last = data.active ? time : 0; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    window.__benchStart = () => { data.frames = []; data.renders = []; data.longTasks = []; data.calls = {}; data.active = true; data.start = performance.now() }
    window.__benchStop = () => {
      data.active = false
      const stats = values => {
        const sorted = [...values].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0
        return { n: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1), over50: sorted.filter(x => x > 50).length, over100: sorted.filter(x => x > 100).length }
      }
      return { ms: performance.now() - data.start, frame: stats(data.frames), render: stats(data.renders), longTasks: data.longTasks, calls: data.calls }
    }
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  results.environment = await page.evaluate(() => {
    const map = window.__map, gl = map.painter.context.gl
    return { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) }
  })
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const reset = async () => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.evaluate(camera => { window.__map.jumpTo(camera) }, camera)
    await page.waitForTimeout(1500)
  }
  const motion = async kind => {
    if (kind === 'drag') {
      const acknowledgements = []
      const pending = []
      const dispatch = event => {
        const sent = performance.now()
        pending.push(cdp.send('Input.dispatchTouchEvent', event).then(() => acknowledgements.push(performance.now() - sent)))
      }
      for (let pass = 0; pass < 2; pass++) {
        dispatch({ type: 'touchStart', touchPoints: [{ x: 195, y: 320 }] })
        for (let i = 1; i <= 24; i++) {
          dispatch({ type: 'touchMove', touchPoints: [{ x: 195 + Math.sin(i / 24 * Math.PI) * 90, y: 320 + i * 5.625 * (pass ? -1 : 1) }] })
          await new Promise(resolve => setTimeout(resolve, 16))
        }
        dispatch({ type: 'touchEnd', touchPoints: [] })
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      await Promise.all(pending)
      acknowledgements.sort((a, b) => a - b)
      results.inputAcknowledgements = acknowledgements
    } else {
      await page.evaluate(async ({ kind, camera }) => {
        const map = window.__map
        const steps = kind === 'pan' ? [{ center: [camera.center[0] + .01, camera.center[1] + .0051] }, { center: camera.center }] : [{ pitch: 75, bearing: 100 }, { pitch: 10, bearing: 20 }]
        for (const step of steps) await new Promise(resolve => { map.once('moveend', resolve); map.easeTo({ ...step, duration: 1600, easing: t => t }) })
      }, { kind, camera })
    }
    await page.waitForTimeout(700)
  }
  for (const config of configurations.filter(c => !process.env.BENCH_CONFIG || process.env.BENCH_CONFIG.split(',').includes(c.name))) {
    await page.evaluate(config => window.__benchConfig(config), config)
    await reset(); await page.waitForTimeout(7000)
    const census = await page.evaluate(() => ({ layers: __map.getStyle().layers.length, sources: Object.keys(__map.getStyle().sources).length, transit: __map.getStyle().layers.filter(l => l.id.startsWith('portolan')).length, cycling: __map.getStyle().layers.filter(l => l.id.includes('cycling') && l.layout?.visibility !== 'none').length }))
    for (const rate of (process.env.BENCH_RATES || '1,4,6').split(',').map(Number)) {
      for (let repeat = 0; repeat < +(process.env.BENCH_REPEATS || 2); repeat++) for (const kind of ['pan', 'tilt', 'drag']) {
        const preparation = performance.now()
        await reset()
        const preparationMs = performance.now() - preparation
        await cdp.send('Emulation.setCPUThrottlingRate', { rate })
        if (process.env.BENCH_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
        const before = await metrics()
        await page.evaluate(() => window.__benchStart())
        const start = await page.evaluate(() => ({ center: __map.getCenter(), pitch: __map.getPitch(), bearing: __map.getBearing() }))
        results.inputAcknowledgements = []
        await motion(kind)
        const inputAcknowledgements = results.inputAcknowledgements
        delete results.inputAcknowledgements
        const measured = await page.evaluate(() => ({ ...window.__benchStop(), end: { center: __map.getCenter(), pitch: __map.getPitch(), bearing: __map.getBearing() } }))
        const after = await metrics()
        const run = { preparationMs, inputAcknowledgements, config: config.name, rate, repeat, kind, census, start, ...measured, cpuMs: (after.TaskDuration - before.TaskDuration) * 1000, scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000 }
        results.runs.push(run)
        if (process.env.BENCH_PROFILE) { const { profile } = await cdp.send('Profiler.stop'); await fs.writeFile(`${output}.${config.name}-${rate}-${repeat}-${kind}.cpuprofile`, JSON.stringify(profile)) }
        await fs.writeFile(output, JSON.stringify(results, null, 2))
        console.log(JSON.stringify({ config: run.config, rate, repeat, kind, preparationMs: Math.round(preparationMs), measuredMs: Math.round(run.ms), p95: Math.round(run.frame.p95), max: Math.round(run.frame.max), longTasks: run.longTasks.length, render95: Math.round(run.render.p95) }))
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await page.screenshot({ path: `${output}.${config.name}.png` })
  }
} finally { await browser.close() }
