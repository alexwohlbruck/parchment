import { describe, expect, it } from 'vitest'
import { overlayPaths, pathsUnder, sameValue } from './sync-scope'

describe('overlayPaths', () => {
  it('takes only the named fields from the source', () => {
    const device = { radius: 1, accentColor: 'blue' }
    const account = { radius: 0.5, accentColor: 'red' }
    expect(overlayPaths(device, account, ['radius'])).toEqual({ radius: 0.5, accentColor: 'blue' })
  })

  it('reaches into nested slices without touching their siblings', () => {
    const device = { general: { avoidTolls: true }, mode: { walking: { speed: 4 }, cycling: { speed: 15 } } }
    const account = { general: {}, mode: { walking: { speed: 5 }, cycling: { speed: 20 } } }
    expect(overlayPaths(device, account, ['mode.walking'])).toEqual({
      general: { avoidTolls: true },
      mode: { walking: { speed: 5 }, cycling: { speed: 15 } },
    })
  })

  it('drops a field the source does not have', () => {
    expect(overlayPaths({ radius: 1, uiTheme: 'glass' }, {}, ['radius'])).toEqual({ uiTheme: 'glass' })
  })

  it('builds the section when the target has none', () => {
    expect(overlayPaths(undefined, { radius: 1 }, ['radius'])).toEqual({ radius: 1 })
  })

  it('takes the whole source for an empty path', () => {
    expect(overlayPaths(['bus'], ['rail'], [''])).toEqual(['rail'])
    expect(overlayPaths(['bus'], undefined, [''])).toBeUndefined()
  })

  it('leaves the target alone with no paths', () => {
    const device = { radius: 1 }
    expect(overlayPaths(device, { radius: 0 }, [])).toBe(device)
  })
})

describe('pathsUnder', () => {
  const keys = ['app.theme.radius', 'app.themeExtra', 'navigation.routing.mode.walking', 'navigation.speech']

  it('lists paths relative to the prefix', () => {
    expect(pathsUnder(keys, 'app.theme')).toEqual(['radius'])
    expect(pathsUnder(keys, 'navigation.routing')).toEqual(['mode.walking'])
  })

  it('names the prefix itself with an empty path', () => {
    expect(pathsUnder(keys, 'navigation.speech')).toEqual([''])
  })
})

describe('sameValue', () => {
  it('ignores key order and absent fields', () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(true)
  })

  it('tells nested and list differences apart', () => {
    expect(sameValue({ b: { c: [1, 2] } }, { b: { c: [2, 1] } })).toBe(false)
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameValue(undefined, {})).toBe(false)
  })
})
