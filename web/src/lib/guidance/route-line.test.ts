import { describe, expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { routeGradient } from './route-line'
import { polyline } from './test-routes'

const walkThenDrive = buildNavRoute([
  { mode: 'walking', geometry: polyline([[0, 100]]) },
  { mode: 'driving', geometry: polyline([[0, 300]], polyline([[0, 100]]).at(-1)) },
])
const color = (mode: string) => (mode === 'walking' ? 'blue' : 'violet')

describe('routeGradient', () => {
  test('colours each segment by mode before any travel', () => {
    expect(routeGradient(walkThenDrive, 0, color, 'grey')).toEqual(['step', ['line-progress'], 'blue', expect.closeTo(0.25, 2), 'violet'])
  })

  test('greys the travelled part and starts the remaining colour at the puck', () => {
    expect(routeGradient(walkThenDrive, 200, color, 'grey')).toEqual(['step', ['line-progress'], 'grey', expect.closeTo(0.5, 2), 'violet'])
  })

  test('a finished route is all travelled', () => {
    expect(routeGradient(walkThenDrive, 1e6, color, 'grey')).toEqual(['step', ['line-progress'], 'grey', 1, 'grey'])
  })
})
