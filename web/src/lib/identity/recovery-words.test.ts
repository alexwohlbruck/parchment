import { describe, expect, test } from 'vitest'
import { bytesToBase64, generateSeed } from './federation-crypto'
import {
  parseRecoveryWords,
  pickCheckPositions,
  RECOVERY_WORD_COUNT,
  RecoveryWordsError,
  sameRecoveryWord,
  seedToRecoveryWords,
} from './recovery-words'

const ZERO_SEED = new Uint8Array(32)
// BIP-39 test vector for 256 bits of zero entropy.
const ZERO_WORDS = [...Array(23).fill('abandon'), 'art']

function problemOf(input: string) {
  try {
    parseRecoveryWords(input)
  } catch (error) {
    if (error instanceof RecoveryWordsError) return [error.problem, error.word]
    throw error
  }
  return null
}

describe('recovery words', () => {
  test('encode the seed as the standard 24 BIP-39 words', () => {
    expect(seedToRecoveryWords(ZERO_SEED)).toEqual(ZERO_WORDS)
  })

  test('round-trip any seed', () => {
    const seed = generateSeed()
    const words = seedToRecoveryWords(seed)
    expect(words).toHaveLength(RECOVERY_WORD_COUNT)
    expect(parseRecoveryWords(words.join(' '))).toEqual(seed)
  })

  test('parse however they were written down', () => {
    const seed = generateSeed()
    const words = seedToRecoveryWords(seed)
    const numbered = words.map((word, i) => `${i + 1}. ${word.toUpperCase()}`).join('\n')
    expect(parseRecoveryWords(`  ${numbered}\n`)).toEqual(seed)
    expect(parseRecoveryWords(words.join(',  '))).toEqual(seed)
  })

  test('name the word that is not on the list', () => {
    const words = [...ZERO_WORDS]
    words[4] = 'abandn'
    expect(problemOf(words.join(' '))).toEqual(['unknown-word', 'abandn'])
  })

  test('reject a missing word and a wrong order', () => {
    expect(problemOf(ZERO_WORDS.slice(1).join(' '))).toEqual(['word-count', undefined])
    const swapped = [ZERO_WORDS[23], ...ZERO_WORDS.slice(0, 23)]
    expect(problemOf(swapped.join(' '))).toEqual(['checksum', undefined])
  })
})

describe('base64 recovery keys from before the words', () => {
  test('are not accepted', () => {
    const legacy = bytesToBase64(generateSeed())
    expect(problemOf(legacy)).not.toBeNull()
    expect(problemOf(legacy.match(/.{1,5}/g)!.join(' '))).not.toBeNull()
  })

  test('an empty entry asks for all 24 words', () => {
    expect(problemOf('')).toEqual(['word-count', undefined])
  })
})

describe('word check', () => {
  test('asks for distinct positions in reading order', () => {
    const rolls = [0.99, 0.5, 0.5, 0]
    const positions = pickCheckPositions(3, () => rolls.shift()!)
    expect(positions).toEqual([0, 12, 23])
  })

  test('ignores case and stray spaces', () => {
    expect(sameRecoveryWord(' Abandon ', 'abandon')).toBe(true)
    expect(sameRecoveryWord('abandn', 'abandon')).toBe(false)
  })
})
