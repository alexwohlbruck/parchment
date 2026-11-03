import { describe, expect, test } from 'vitest'
import type { NavRoute } from '../nav-route'
import { gridWalk } from '../test-routes'
import { blocksTo } from './blocks'

const grid = (...starts: number[]) => starts.map((s, i): [number, string] => [s, `Street ${i + 1}`])
const blocks = (route: NavRoute, from = 0) => blocksTo(route, from, route.steps[1])

describe('blocksTo', () => {
  test('counts the corners to the turn on a regular grid', () => {
    expect(blocks(gridWalk(grid(200, 400, 600, 800)), 20)).toBe(5)
    expect(blocks(gridWalk(grid(200, 400, 600, 800)), 520)).toBe(3)
  })

  test("a parkway's service roads and malls are one junction", () => {
    const parkway: [number, string][] = [[480, 'Eastern Parkway Service Road'], [510, 'Eastern Parkway'], [545, 'Eastern Parkway Service Road']]
    expect(blocks(gridWalk([[200, 'Lincoln Place'], ...parkway, [800, 'Union Street']]))).toBe(4)
  })

  test('crossing the street walked along is no block', () => {
    expect(blocks(gridWalk([...grid(200, 500, 800), [600, 'Rogers Avenue']]))).toBe(4)
  })

  test('gives up where a long block could hide a junction the route never crosses', () => {
    expect(blocks(gridWalk(grid(200, 400, 600)), 20)).toBeNull()
    expect(blocks(gridWalk(grid(700, 850)), 20)).toBeNull()
  })

  test('one corner away is not counted in blocks', () => {
    expect(blocks(gridWalk(grid(500)), 400)).toBeNull()
  })
})
