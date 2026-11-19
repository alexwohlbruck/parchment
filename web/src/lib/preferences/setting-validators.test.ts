import { describe, expect, it } from 'vitest'
import { isBoolean, oneOf, pickKnown, pickValid, type Validators } from './setting-validators'

interface Settings {
  basemap: 'standard' | 'satellite'
  labels: boolean
}

const validators: Validators<Settings> = {
  basemap: oneOf(['standard', 'satellite']),
  labels: isBoolean,
}

describe('pickValid', () => {
  it('keeps known settings with usable values', () => {
    expect(pickValid(validators, { basemap: 'satellite', labels: false })).toEqual({
      basemap: 'satellite',
      labels: false,
    })
  })

  it('leaves out unknown settings and values it cannot use', () => {
    expect(pickValid(validators, { basemap: 'lunar', labels: 'yes', zoom: 4 })).toEqual({})
  })

  it('reads nothing from a section that is not an object', () => {
    expect(pickValid(validators, null)).toEqual({})
    expect(pickValid(validators, 'satellite')).toEqual({})
  })
})

describe('pickKnown', () => {
  it('drops everything without a validator', () => {
    const source = { basemap: 'standard', labels: true, engine: 'maplibre' } as Settings
    expect(pickKnown(validators, source)).toEqual({ basemap: 'standard', labels: true })
  })
})
