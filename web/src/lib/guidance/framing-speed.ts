// The speed the follow camera sizes its view for: held in coarse bands so a
// few mph of wobble never reaches the zoom, while a real change moves it once.

/** Band speeds, m/s, about 1.6× apart; a band's edges sit halfway (geometrically) to its neighbours. */
const BANDS = [1.5, 2.5, 4, 6.5, 10, 16, 25, 40]
/** How far past a band edge the speed has to go before the band is questioned. */
const EDGE_MARGIN = 0.1
const SAMPLE_SEC = 0.25
const WINDOW_SEC = 4
/** Accelerating zooms out sooner than slowing zooms in. */
const HOLD_SEC = { faster: 2, slower: 4 }
/** Zoom changes smaller than this aren't worth moving the camera for. */
export const ZOOM_DEAD_BAND = 0.15

export interface FramingSpeed {
  samples: { t: number; v: number }[]
  band: number
  /** Direction of a pending band change and when it began. */
  pending: { up: boolean; since: number } | null
}

export function createFramingSpeed(): FramingSpeed {
  return { samples: [], band: -1, pending: null }
}

const edgeBelow = (band: number) => (band === 0 ? 0 : Math.sqrt(BANDS[band - 1] * BANDS[band]))
const edgeAbove = (band: number) => (band === BANDS.length - 1 ? Infinity : Math.sqrt(BANDS[band] * BANDS[band + 1]))

export function speedBand(speed: number): number {
  let band = 0
  while (band < BANDS.length - 1 && speed >= edgeAbove(band)) band++
  return band
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Feeds the latest speed (m/s) at `nowSec`; returns the band speed to frame for. */
export function stepFramingSpeed(state: FramingSpeed, speed: number, nowSec: number): number {
  const last = state.samples.at(-1)
  if (!last || nowSec - last.t >= SAMPLE_SEC) state.samples.push({ t: nowSec, v: speed })
  while (state.samples[0].t < nowSec - WINDOW_SEC) state.samples.shift()
  const typical = median(state.samples.map(s => s.v))

  if (state.band < 0) state.band = speedBand(typical)
  const up = typical > edgeAbove(state.band) * (1 + EDGE_MARGIN)
  const down = typical < edgeBelow(state.band) * (1 - EDGE_MARGIN)
  if (!up && !down) state.pending = null
  else {
    if (state.pending?.up !== up) state.pending = { up, since: nowSec }
    if (nowSec - state.pending.since >= HOLD_SEC[up ? 'faster' : 'slower']) {
      state.band = speedBand(typical)
      state.pending = null
    }
  }
  return BANDS[state.band]
}

/** Keeps the held zoom unless the target has moved far enough, or a maneuver is pulling the view in. */
export function holdZoom(held: number | null, target: number, framingManeuver: boolean): number {
  if (held == null || framingManeuver || Math.abs(target - held) > ZOOM_DEAD_BAND) return target
  return held
}
