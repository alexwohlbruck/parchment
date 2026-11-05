import { describe, expect, it } from 'vitest'
import { openSourceCount } from './open-source'

describe('openSourceCount', () => {
  it('counts a project shared by several products once', () => {
    const shared = { name: 'Vue', url: 'https://vuejs.org' }
    expect(
      openSourceCount([
        { name: 'A', projects: [shared, { name: 'Go', url: 'https://go.dev' }] },
        { name: 'B', projects: [shared] },
      ]),
    ).toBe(2)
  })

})
