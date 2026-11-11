import { chromium } from 'playwright'
const sid = (await import('fs')).readFileSync('/tmp/bs-sid', 'utf8').trim()
const views = JSON.parse(process.argv[2])
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP vega5.tailc47d6.ts.net 100.70.133.121', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, colorScheme: 'light' })
await ctx.addCookies([{ name: 'auth_session', value: sid, domain: 'vega5.tailc47d6.ts.net', path: '/', secure: true }])
const page = await ctx.newPage()
await page.addInitScript(() => performance.setResourceTimingBufferSize(20000))
await page.goto('https://vega5.tailc47d6.ts.net:8401/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(12000)
for (const t of ['Cancel', 'Not now', 'Skip']) { const b = page.getByRole('button', { name: t }); if (await b.count()) await b.first().click().catch(() => {}) }
await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('maplibre-gl') && n.includes('.mjs'))
  const m = await import(url); const M = m.Map || m.default.Map
  const orig = M.prototype.getZoom
  M.prototype.getZoom = function () { window.__map = this; return orig.apply(this, arguments) }
  dispatchEvent(new Event('resize'))
})
await page.waitForFunction(() => !!window.__map, null, { timeout: 30000 })
await page.locator('button:has(svg[class*="layers"])').first().hover()
await page.waitForTimeout(1500)
const sw = page.locator('[role=switch][aria-label="Bike suitability"]').first()
if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click({ force: true })
await page.mouse.move(300, 600)
for (const v of views) {
  await page.evaluate(v => window.__map.jumpTo({ center: [v.lng, v.lat], zoom: v.z, pitch: 0, bearing: 0 }), v)
  await page.waitForTimeout(2000)
  await page.evaluate(() => new Promise(r => { window.__map.once('idle', r); window.__map.triggerRepaint(); setTimeout(r, 60000) }))
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `/tmp/bike-suit/${v.name}.png`, timeout: 120000 })
  console.log('shot', v.name)
}
await browser.close()
