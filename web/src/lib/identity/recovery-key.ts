import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { base64ToBytes } from './federation-crypto'

export const RECOVERY_WORD_COUNT = 24

export type RecoveryKeyProblem = 'unknown-word' | 'word-count' | 'checksum'

export class RecoveryKeyError extends Error {
  constructor(
    readonly problem: RecoveryKeyProblem,
    readonly word?: string,
  ) {
    super(`Invalid recovery key: ${problem}`)
  }
}

/** The seed as 24 BIP-39 words, the last carrying a checksum. */
export function seedToRecoveryWords(seed: Uint8Array): string[] {
  return entropyToMnemonic(seed, wordlist).split(' ')
}

/** Keys saved before recovery words were the seed as 44 characters of base64, shown in groups of 5. */
const LEGACY_KEY = /^[A-Za-z0-9+/]{43}=$/

const toWords = (input: string) => input.toLowerCase().split(/[^a-z]+/).filter(Boolean)

/** The seed from 24 recovery words, however they are numbered or spaced, or from a legacy base64 key. */
export function parseRecoveryKey(input: string): Uint8Array {
  const compact = input.replace(/\s+/g, '')
  if (LEGACY_KEY.test(compact)) return base64ToBytes(compact)

  const words = toWords(input)
  const unknown = words.find(word => !wordlist.includes(word))
  if (unknown) throw new RecoveryKeyError('unknown-word', unknown)
  if (words.length !== RECOVERY_WORD_COUNT) throw new RecoveryKeyError('word-count')
  try {
    return mnemonicToEntropy(words.join(' '), wordlist)
  } catch {
    throw new RecoveryKeyError('checksum')
  }
}

/** Positions (from 0) of the words a user retypes to show they kept a copy, in reading order. */
export function pickCheckPositions(count = 3, random: () => number = Math.random): number[] {
  const positions = new Set<number>()
  while (positions.size < count) positions.add(Math.floor(random() * RECOVERY_WORD_COUNT))
  return [...positions].sort((a, b) => a - b)
}

export const sameRecoveryWord = (typed: string, word: string) => typed.trim().toLowerCase() === word
