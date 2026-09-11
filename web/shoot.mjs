import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const SID = readFileSync('/tmp/sid.txt', 'utf8').trim()
const BASE = 'https://vega5.tailc47d6.ts.net:8403'

const SHOTS = [
  { name: 'z13-network',  center: [-73.9750, 40.6890], zoom: 13 },
  { name: 'z15-bedstuy',  center: [-73.9570, 40.6900], zoom: 15 },
  { name: 'z17-bedford',  center: [-73.9565, 40.6960], zoom: 17 },
  { name: 'z18-lanes',    center: [-73.9565, 40.6960], zoom: 18.4 },
  { name: 'z17-dark',     center: [-73.9565, 40.6960], zoom: 17, dark: true },
]

const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP vega5.tailc47d6.ts.net 100.70.133.121'],
})
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 800 },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
})
await ctx.addCookies([{ name: 'auth_session', value: SID, domain: 'vega5.tailc47d6.ts.net', path: '/', secure: true }])

const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)) })

await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(3000)
await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('map') || '{}')
  m.engine = 'maplibre'; m.theme = 'light'
  localStorage.setItem('map', JSON.stringify(m))
  localStorage.setItem('vueuse-color-scheme', 'light')
  localStorage.setItem('parchment-group-visibility', JSON.stringify({ 'default:group:cycling': true, 'default:group:transit': false }))
})

for (const shot of SHOTS) {
  await page.evaluate(dark => {
    const m = JSON.parse(localStorage.getItem('map') || '{}')
    m.theme = dark ? 'dark' : 'light'
    localStorage.setItem('map', JSON.stringify(m))
    localStorage.setItem('vueuse-color-scheme', dark ? 'dark' : 'light')
  }, !!shot.dark)
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.evaluate(() => document.querySelectorAll('[role="dialog"] button[aria-label="Close"]').forEach(b => b.click()))

  const ok = await page.evaluate(async ([center, zoom]) => {
    const m = window.__parchmentMap
    if (!m) return 'no map'
    // Switch on everything green, whatever layer it lives in.
    for (const l of m.getStyle().layers) {
      if (/cycling|^Cycling |bicycle/i.test(l.id)) {
        try { m.setLayoutProperty(l.id, 'visibility', 'visible') } catch {}
      }
    }
    m.jumpTo({ center, zoom, pitch: 0, bearing: 0 })
    await new Promise(r => setTimeout(r, 200))
    return m.getStyle().layers.filter(l => /cycling|^Cycling |bicycle/i.test(l.id)).map(l => l.id).join(',')
  }, [shot.center, shot.zoom])
  console.log(shot.name, '->', String(ok).slice(0, 200))

  await page.waitForTimeout(7000)
  await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const keep = new Set(); for (let n = c; n; n = n.parentElement) keep.add(n)
    const walk = el => { for (const ch of Array.from(el.children)) { if (ch === c) continue; keep.has(ch) ? walk(ch) : (ch.style.display = 'none') } }
    walk(document.body)
  })
  await page.waitForTimeout(500)
  // CDP rather than page.screenshot: the latter blocks on document.fonts,
  // which never settles once the DOM around the canvas is hidden.
  const cdp = await page.context().newCDPSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`/tmp/bike-${shot.name}.png`, Buffer.from(data, 'base64'))
  console.log('  saved /tmp/bike-' + shot.name + '.png')
}
await browser.close()
