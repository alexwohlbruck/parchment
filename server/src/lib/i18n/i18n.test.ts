import { describe, expect, it } from 'bun:test'
import enUS from './locales/en-US.json'
import esES from './locales/es-ES.json'
import { LANGUAGES, DEFAULT_LANGUAGE, getBestLanguage, detectLanguage, getLanguageCode, isValidLanguage } from './index'

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
