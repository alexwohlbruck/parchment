import { expect, test } from 'vitest'
import { buildNavRoute } from './nav-route'
import { turnCallout } from './turn-callout'
import { polyline } from './test-routes'

const geometry = polyline([[0, 100], [270, 100]])
const route = buildNavRoute([
  {
    mode: 'cycling',
    geometry,
    instructions: [
      { type: 'depart', text: '', distance: 100, duration: 20, streetName: 'Sterling Place', coordinate: geometry[0] },
      { type: 'turn', modifier: 'left', text: '', distance: 100, duration: 20, streetName: 'Underhill Avenue', coordinate: geometry[10] },
      { type: 'destination', text: '', distance: 0, duration: 0, coordinate: geometry.at(-1)! },
    ],
  } as never,
])

test('names the road turned onto, on the side of the turn', () => {
  const step = route.steps.find(s => s.instruction.type === 'turn')!
  const callout = turnCallout(route, step)
  expect(callout.side).toBe('left')
  expect(callout.kind).toBe('left')
  expect(callout.road).toMatchObject({ kind: 'named', name: 'Underhill Avenue' })
  expect(callout.at).toBeCloseTo(step.startDistance)
})
