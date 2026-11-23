import { describe, expect, test } from 'vitest'
import { offersParking, parkingDestination, parkingKind, parkingOptions, PARKING_OFFER_M } from './parking'
import type { Place } from '@/types/place.types'

const door = { lat: 35.2271, lng: -80.8431 }
const lot = (id: string, lat: number, tags: Record<string, string> = {}, name?: string) =>
  ({ id, name: name ? { value: name } : undefined, geometry: { value: { center: { lat, lng: door.lng } } }, tags }) as unknown as Place

describe('parkingOptions', () => {
  test('lists the shortest walk first', () => {
    const options = parkingOptions([lot('far', door.lat + 0.004), lot('near', door.lat + 0.001)], door)
    expect(options.map(o => o.id)).toEqual(['near', 'far'])
    expect(options[0].walkSeconds).toBeGreaterThan(60)
  })

  test('leaves out private lots and lots too far to walk from', () => {
    const options = parkingOptions([
      lot('staff', door.lat + 0.001, { access: 'private' }),
      lot('across town', door.lat + 0.05),
      lot('public', door.lat + 0.001, { access: 'yes' }),
    ], door)
    expect(options.map(o => o.id)).toEqual(['public'])
  })

  test('names an unnamed lot after whoever runs it', () => {
    const [option] = parkingOptions([lot('deck', door.lat + 0.001, { operator: 'SP+' })], door)
    expect(option.name).toBe('SP+')
  })

  test('reads the name, kind and fee from the tags', () => {
    const [option] = parkingOptions([lot('deck', door.lat + 0.001, { parking: 'multi-storey', fee: 'yes' }, 'Plaza Deck')], door)
    expect(option).toMatchObject({ name: 'Plaza Deck', kind: 'garage', paid: true })
  })
})

describe('parkingKind', () => {
  test('tells garages, street spaces and lots apart', () => {
    expect(parkingKind({ parking: 'underground' })).toBe('underground')
    expect(parkingKind({ parking: 'street_side' })).toBe('street')
    expect(parkingKind({ parking: 'surface' })).toBe('lot')
    expect(parkingKind(undefined)).toBe('lot')
  })
})

describe('parkingDestination', () => {
  const end = { label: 'Bakery', location: door }

  test('leads to where the drive was going', () => {
    expect(parkingDestination([{ mode: 'driving', end }], 0)).toEqual({ location: door, label: 'Bakery' })
  })

  test('leads past the lot the leg already parks at', () => {
    const segments = [{ mode: 'driving', end: { label: 'Lot', location: { lat: 0, lng: 0 } } }, { mode: 'walking', end }]
    expect(parkingDestination(segments, 0)?.label).toBe('Bakery')
  })

  test('has nothing to offer off the road', () => {
    expect(parkingDestination([{ mode: 'walking', end }], 0)).toBeNull()
  })
})

describe('offersParking', () => {
  const drive = { mode: 'driving' }

  test('offers on the final approach of a drive to the door', () => {
    expect(offersParking([drive], 0, 800)).toBe(true)
    expect(offersParking([drive], 0, PARKING_OFFER_M + 1)).toBe(false)
  })

  test('stays quiet when the leg already parks', () => {
    expect(offersParking([drive, { mode: 'walking' }], 0, 800)).toBe(false)
  })
})
