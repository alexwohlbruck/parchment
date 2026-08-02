import { describe, expect, it } from 'bun:test'
import enUS from './locales/en-US.json'
import esES from './locales/es-ES.json'
import { LANGUAGES, DEFAULT_LANGUAGE, getBestLanguage, detectLanguage, getLanguageCode, isValidLanguage } from './index'
import { initialization, translate } from './translate'
import { resolveDisplayChips } from '../display-chips'
import { getLocalizedName } from '../place.utils'

const locales = { 'en-US': enUS, 'es-ES': esES } as const

/** Dotted leaf paths of a locale tree, e.g. `errors.auth.unauthorized`. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix]
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

function leafEntries(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, value]) =>
    leafEntries(value, prefix ? `${prefix}.${key}` : key),
  )
}

/** Interpolation placeholders in a string, e.g. `{{field}}`. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]).sort()
}

const referenceKeys = leafKeys(enUS).sort()

describe('locale files', () => {
  it('has at least one key to check', () => {
    expect(referenceKeys.length).toBeGreaterThan(0)
  })

  for (const [locale, resource] of Object.entries(locales)) {
    describe(locale, () => {
      it('is at key parity with en-US', () => {
        expect(leafKeys(resource).sort()).toEqual(referenceKeys)
      })

      it('has no empty or whitespace-only values', () => {
        const empty = leafEntries(resource)
          .filter(([, value]) => value.trim() === '')
          .map(([key]) => key)
        expect(empty).toEqual([])
      })

      it('has string values at every leaf', () => {
        const nonStrings = leafEntries(resource).length
        expect(nonStrings).toBe(referenceKeys.length)
      })

      it('preserves the interpolation placeholders used in en-US', () => {
        const reference = Object.fromEntries(leafEntries(enUS))
        const mismatched = leafEntries(resource)
          .filter(
            ([key, value]) =>
              JSON.stringify(placeholders(value)) !==
              JSON.stringify(placeholders(reference[key] ?? '')),
          )
          .map(([key]) => key)
        expect(mismatched).toEqual([])
      })
    })
  }
})

describe('language detection', () => {
  it('defaults when no hints are given', () => {
    expect(getBestLanguage()).toBe(DEFAULT_LANGUAGE)
    expect(detectLanguage()).toBe(DEFAULT_LANGUAGE)
  })

  it('picks the highest-quality supported language from Accept-Language', () => {
    expect(getBestLanguage('fr-FR;q=0.9,es-MX;q=0.8')).toBe('es-ES')
    expect(getBestLanguage('es-ES,en-US;q=0.9')).toBe('es-ES')
  })

  it('falls back to the default for unsupported languages', () => {
    expect(getBestLanguage('fr-FR,de-DE;q=0.9')).toBe(DEFAULT_LANGUAGE)
  })

  it('prefers an explicit query param over Accept-Language', () => {
    expect(detectLanguage('es', 'en-US')).toBe('es-ES')
    expect(detectLanguage('zz', 'es-ES')).toBe('es-ES')
  })

  it('only accepts languages the resources cover', () => {
    for (const language of LANGUAGES) expect(isValidLanguage(language)).toBe(true)
    expect(isValidLanguage('fr')).toBe(false)
  })

  it('reduces to a two-letter code for external APIs', () => {
    expect(getLanguageCode('es-ES')).toBe('es')
    expect(getLanguageCode('fr-FR')).toBe('en')
  })
})

describe('translation lookup', () => {
  it('resolves a key in the requested language', async () => {
    await initialization

    expect(translate('en-US')('errors.auth.unauthorized')).toBe('You must be signed in')
    expect(translate('es-ES')('errors.auth.unauthorized')).toBe('Debes iniciar sesión')
  })

  it('resolves chip keys that contain a colon', async () => {
    await initialization

    // `nsSeparator` has to stay off for these — i18next would otherwise read
    // `chips.payment` as a namespace and never find the key.
    expect(translate('en-US')('chips.payment:cash_yes')).toBe('Cash')
    expect(translate('es-ES')('chips.payment:cash_yes')).toBe('Efectivo')
    expect(translate('es-ES')('chips.diet:vegan_only')).toBe('Solo vegano')
  })
})

describe('display chips', () => {
  const tags = {
    wheelchair: 'yes',
    'diet:vegan': 'only',
    'payment:contactless': 'yes',
    internet_access: 'wlan',
    'internet_access:fee': 'no',
    cuisine: 'italian',
  }

  it('labels every chip in the requested language', async () => {
    await initialization

    const en = resolveDisplayChips(tags, translate('en-US'))
    const es = resolveDisplayChips(tags, translate('es-ES'))

    expect(en.chips.map((c) => c.label).sort()).toEqual([
      'Accessible',
      'Contactless',
      'Free Wi-Fi',
      'Vegan Only',
    ])
    expect(es.chips.map((c) => c.label).sort()).toEqual([
      'Accesible',
      'Sin contacto',
      'Solo vegano',
      'Wi-Fi gratis',
    ])
  })

  it('never renders a raw locale key', async () => {
    await initialization

    for (const language of LANGUAGES) {
      for (const chip of resolveDisplayChips(tags, translate(language)).chips) {
        expect(chip.label).not.toContain('chips.')
      }
    }
  })

  it('leaves non-chip tags for the tag list', async () => {
    await initialization

    const { remainingTags } = resolveDisplayChips(tags, translate('es-ES'))
    expect(remainingTags).toEqual({ cuisine: 'italian' })
  })
})

describe('localized place names', () => {
  const tags = { name: 'Hudson River', 'name:es': 'Río Hudson', 'name:fr': 'Fleuve Hudson' }

  it('prefers the name tag for the requested language', () => {
    expect(getLocalizedName(tags, 'es-ES')).toBe('Río Hudson')
  })

  it('keeps the on-the-ground name for English', () => {
    // `name` is what mappers maintain; `name:en` is often absent or worse.
    expect(getLocalizedName({ ...tags, 'name:en': 'The Hudson' }, 'en-US')).toBe('Hudson River')
  })

  it('falls back when the language has no tag', () => {
    expect(getLocalizedName({ name: 'Brooklyn Bridge' }, 'es-ES')).toBe('Brooklyn Bridge')
  })

  it('prefers an explicit fallback over the raw name tag', () => {
    expect(getLocalizedName({ name: 'Raw' }, 'es-ES', 'Adapted')).toBe('Adapted')
  })

  it('returns undefined for an unnamed place', () => {
    expect(getLocalizedName({ leisure: 'park' }, 'es-ES')).toBeUndefined()
  })
})
