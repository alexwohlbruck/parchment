import { expect, it } from 'vitest'
import { lightAbout, multiply } from './sun-shadow'

it('a mesh drawn about an origin lands where its mercator point does', () => {
  const light = new Float64Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, -1, -1, 0, 1])
  const about = lightAbout(light, [0.25, 0.5])
  const direct = multiply(light, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25 + 0.125, 0.5, 0.01, 1])
  expect([about[0] * 0.125 + about[12], about[13], about[10] * 0.01 + about[14]]).toEqual([direct[12], direct[13], direct[14]])
})

it('equals the light times a translation to the origin', () => {
  const light = new Float64Array([2, 0.5, 0, 0.1, -0.3, 3, 0.2, 0, 0.7, 0, 4, -0.2, -1, -1, 0.4, 1])
  const origin: [number, number, number] = [0.2947, 0.3759, 0.00001]
  expect(lightAbout(light, origin)).toEqual(Float32Array.from(multiply(light, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...origin, 1])))
})
