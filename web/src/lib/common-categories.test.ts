import { describe, it, expect } from 'vitest'
import * as LucideIcons from 'lucide-vue-next'
import { COMMON_CATEGORIES } from './common-categories'
import en from './i18n/en-US.json'
import es from './i18n/es-ES.json'

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<any>((node, part) => node?.[part], dict)
}

describe('COMMON_CATEGORIES', () => {
  // Both of these fail silently in the UI: ItemIcon falls back to a folder
  // glyph for an unknown icon, and vue-i18n renders the raw key path.
  it.each(COMMON_CATEGORIES)('$id resolves its icon and label', category => {
    expect(
      typeof LucideIcons[`${category.icon}Icon` as keyof typeof LucideIcons],
    ).toBe('function')
    expect(lookup(en, category.labelKey)).toBeTypeOf('string')
    expect(lookup(es, category.labelKey)).toBeTypeOf('string')
  })

  it('has no duplicate presets or icons', () => {
    const ids = COMMON_CATEGORIES.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)

    // A repeated glyph in a row of browse chips reads as a mistake.
    const icons = COMMON_CATEGORIES.map(c => c.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('uses well-formed OSM preset ids', () => {
    for (const { id } of COMMON_CATEGORIES) {
      expect(id).toMatch(/^[a-z_]+\/[a-z_]+$/)
    }
  })
})
