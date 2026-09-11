import { describe, it, expect } from 'vitest'
import {
  groupFields,
  isFieldVisible,
  sectionFor,
  hasValue,
} from './field-groups'
import type { FieldDefinition } from '@/types/quick-edit.types'

function field(partial: Partial<FieldDefinition> & { id: string }): FieldDefinition {
  return {
    key: partial.id,
    type: 'text',
    label: partial.id,
    primary: true,
    ...partial,
  }
}

describe('sectionFor', () => {
  it('sorts fields by what they describe', () => {
    expect(sectionFor(field({ id: 'name' }))).toBe('basics')
    expect(sectionFor(field({ id: 'outdoor_seating', type: 'check' }))).toBe('features')
    expect(sectionFor(field({ id: 'opening_hours', key: 'opening_hours' }))).toBe('hours')
    expect(sectionFor(field({ id: 'address', type: 'address' }))).toBe('address')
    expect(sectionFor(field({ id: 'phone', key: 'phone' }))).toBe('contact')
  })

  it('drops non-primary fields to the more section', () => {
    expect(sectionFor(field({ id: 'fhrs', primary: false }))).toBe('more')
  })
})

describe('isFieldVisible', () => {
  const fields = [
    field({ id: 'internet_access', key: 'internet_access', type: 'combo' }),
    field({ id: 'internet_access/fee', key: 'internet_access:fee', type: 'combo' }),
    field({ id: 'drive_through', key: 'drive_through', type: 'check' }),
    field({
      id: 'opening_hours/drive_through',
      key: 'opening_hours:drive_through',
      type: 'combo',
    }),
  ]

  it('hides a dependent field until its dependency has a value', () => {
    const fee = fields[1]
    expect(isFieldVisible(fee, fields, {})).toBe(false)
    expect(isFieldVisible(fee, fields, { internet_access: 'wlan' })).toBe(true)
  })

  it('keeps a dependent field hidden when the dependency says no', () => {
    expect(isFieldVisible(fields[1], fields, { internet_access: 'no' })).toBe(false)
  })

  it('follows explicit dependencies that the id does not imply', () => {
    const driveThroughHours = fields[3]
    expect(isFieldVisible(driveThroughHours, fields, { opening_hours: '24/7' })).toBe(
      false,
    )
    expect(isFieldVisible(driveThroughHours, fields, { drive_through: 'yes' })).toBe(
      true,
    )
  })

  it('never hides a field the feature already has a value for', () => {
    expect(
      isFieldVisible(fields[1], fields, { 'internet_access:fee': 'no' }),
    ).toBe(true)
  })

  it('always shows fields with no dependency', () => {
    expect(isFieldVisible(fields[0], fields, {})).toBe(true)
  })
})

describe('groupFields', () => {
  it('returns sections in a fixed order, skipping empty ones', () => {
    const sections = groupFields(
      [
        field({ id: 'phone', key: 'phone' }),
        field({ id: 'name' }),
        field({ id: 'outdoor_seating', type: 'check' }),
      ],
      {},
    )
    expect(sections.map((s) => s.id)).toEqual(['basics', 'features', 'contact'])
  })

  it('counts filled fields per section', () => {
    const sections = groupFields(
      [field({ id: 'name' }), field({ id: 'operator', key: 'operator' })],
      { name: 'Taco Bell' },
    )
    expect(sections[0].filled).toBe(1)
  })

  it('lists a field once even when the preset references it twice', () => {
    const sections = groupFields([field({ id: 'name' }), field({ id: 'name' })], {})
    expect(sections[0].fields).toHaveLength(1)
  })
})

describe('hasValue', () => {
  it('recognises an address from any addr: tag', () => {
    const address = field({ id: 'address', type: 'address', key: 'addr' })
    expect(hasValue(address, { 'addr:city': 'Charlotte' })).toBe(true)
    expect(hasValue(address, {})).toBe(false)
  })

  it('recognises multiCombo values spread across prefixed keys', () => {
    const payment = field({ id: 'payment_multi', key: 'payment', type: 'multiCombo' })
    expect(hasValue(payment, { 'payment:cash': 'yes' })).toBe(true)
  })
})
