// Records battery level through a navigation run, so a phone test can be pasted
// into the ticket. Lives outside any component: the run outlasts the settings page.

import { reactive } from 'vue'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import type { BatteryReading } from './battery-report'

interface BatteryManagerLike extends EventTarget {
  level: number
  charging: boolean
}

export const RUN_DURATION_MS = 20 * 60_000
const SAMPLE_MS = 15_000

export const batteryRun = reactive({
  startedAt: null as number | null,
  readings: [] as BatteryReading[],
  supported: 'getBattery' in navigator,
})

let battery: BatteryManagerLike | null = null
let timer: ReturnType<typeof setInterval> | null = null

function sample() {
  const startedAt = batteryRun.startedAt
  if (startedAt == null) return
  const t = Date.now() - startedAt
  batteryRun.readings.push({
    t,
    level: battery?.level ?? null,
    charging: battery?.charging ?? null,
    hidden: document.visibilityState === 'hidden',
    navigating: guidanceEngine.active.value,
    fixIntervalMs: guidanceEngine.fixInterval.value,
  })
  if (t >= RUN_DURATION_MS) stopBatteryRun()
}

export async function startBatteryRun(): Promise<void> {
  stopBatteryRun()
  battery = batteryRun.supported
    ? await (navigator as { getBattery?: () => Promise<BatteryManagerLike> }).getBattery?.().catch(() => null) ?? null
    : null
  batteryRun.readings = []
  batteryRun.startedAt = Date.now()
  battery?.addEventListener('levelchange', sample)
  document.addEventListener('visibilitychange', sample)
  timer = setInterval(sample, SAMPLE_MS)
  sample()
}

export function stopBatteryRun(): void {
  if (timer == null) return
  clearInterval(timer)
  timer = null
  sample()
  battery?.removeEventListener('levelchange', sample)
  document.removeEventListener('visibilitychange', sample)
  batteryRun.startedAt = null
}
