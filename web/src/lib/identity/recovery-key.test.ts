import { describe, expect, test } from 'vitest'
import { bytesToBase64, generateSeed } from './federation-crypto'
import {
  parseRecoveryKey,
  pickCheckPositions,
  RECOVERY_WORD_COUNT,
  RecoveryKeyError,
  sameRecoveryWord,
  seedToRecoveryWords,
} from './recovery-key'

const ZERO_SEED = new Uint8Array(32)
// BIP-39 test vector for 256 bits of zero entropy.
const ZERO_WORDS = [...Array(23).fill('abandon'), 'art']

function problemOf(input: string) {
  try {
    parseRecoveryKey(input)
  } catch (error) {
    if (error instanceof RecoveryKeyError) return [error.problem, error.word]
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
    expect(parseRecoveryKey(words.join(' '))).toEqual(seed)
  })

  test('parse however they were written down', () => {
    const seed = generateSeed()
    const words = seedToRecoveryWords(seed)
    const numbered = words.map((word, i) => `${i + 1}. ${word.toUpperCase()}`).join('\n')
    expect(parseRecoveryKey(`  ${numbered}\n`)).toEqual(seed)
    expect(parseRecoveryKey(words.join(',  '))).toEqual(seed)
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

describe('legacy base64 recovery key', () => {
  test('still parses, bare or in the groups of 5 it was shown in', () => {
    const seed = generateSeed()
    const legacy = bytesToBase64(seed)
    expect(legacy).toHaveLength(44)
    expect(parseRecoveryKey(`  ${legacy}\n`)).toEqual(seed)
    expect(parseRecoveryKey(legacy.match(/.{1,5}/g)!.join(' '))).toEqual(seed)
  })

  test('is rejected at any other length', () => {
    expect(problemOf(bytesToBase64(new Uint8Array(16)))).not.toBeNull()
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
