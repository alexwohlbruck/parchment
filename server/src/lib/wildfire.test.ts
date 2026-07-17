import { describe, test, expect } from 'bun:test'
import { parseFirmsCsv, parseBbox } from './wildfire'

describe('parseBbox', () => {
  test('parses west,south,east,north', () => {
    expect(parseBbox('-124,36,-118,42')).toEqual({
      west: -124,
      south: 36,
      east: -118,
      north: 42,
    })
  })
  test('rejects malformed input', () => {
    expect(parseBbox('bad')).toBeNull()
    expect(parseBbox('1,2,3')).toBeNull() // too few
    expect(parseBbox('1,2,x,4')).toBeNull() // NaN
  })
})

describe('parseFirmsCsv', () => {
  const csv = [
    'country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
    'USA,39.123,-120.456,330.5,0.4,0.36,2026-07-15,2100,N,VIIRS,n,2.0NRT,295.1,12.5,D',
    'USA,39.200,-120.500,367.2,0.4,0.36,2026-07-15,2100,N,VIIRS,h,2.0NRT,300.0,55.0,D',
  ].join('\n')

  test('maps rows to GeoJSON points [lng, lat]', () => {
    const fc = parseFirmsCsv(csv)
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry.coordinates).toEqual([-120.456, 39.123])
    expect(fc.features[0].properties).toMatchObject({
      brightness: 330.5,
      confidence: 'n',
      frp: 12.5,
      dayNight: 'D',
    })
    expect(fc.features[1].properties.confidence).toBe('h')
  })

  test('empty / header-only input → empty collection', () => {
    expect(parseFirmsCsv('').features).toHaveLength(0)
    expect(parseFirmsCsv('latitude,longitude\n').features).toHaveLength(0)
  })

  test('skips rows with non-numeric coordinates', () => {
    const bad = 'latitude,longitude,frp\nx,y,1\n40,-100,3'
    const fc = parseFirmsCsv(bad)
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry.coordinates).toEqual([-100, 40])
  })
})
