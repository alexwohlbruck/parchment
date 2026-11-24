import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

export const RECOVERY_WORD_COUNT = 24

export type RecoveryWordsProblem = 'old-key' | 'unknown-word' | 'word-count' | 'checksum'

export class RecoveryWordsError extends Error {
  constructor(
    readonly problem: RecoveryWordsProblem,
    readonly word?: string,
  ) {
    super(`Invalid recovery words: ${problem}`)
  }
}

/** The seed as 24 BIP-39 words, the last carrying a checksum. */
export function seedToRecoveryWords(seed: Uint8Array): string[] {
  return entropyToMnemonic(seed, wordlist).split(' ')
}

const toWords = (input: string) => input.toLowerCase().split(/[^a-z]+/).filter(Boolean)

/** The 44-character base64 key Parchment showed before recovery words, often in groups of 5. */
const OLD_KEY = /^[A-Za-z0-9+/]{43}=$/

/** The seed from 24 recovery words, however they are numbered or spaced. */
export function parseRecoveryWords(input: string): Uint8Array {
  if (OLD_KEY.test(input.replace(/\s+/g, ''))) throw new RecoveryWordsError('old-key')
  const words = toWords(input)
  const unknown = words.find(word => !wordlist.includes(word))
  if (unknown) throw new RecoveryWordsError('unknown-word', unknown)
  if (words.length !== RECOVERY_WORD_COUNT) throw new RecoveryWordsError('word-count')
  try {
    return mnemonicToEntropy(words.join(' '), wordlist)
  } catch {
    throw new RecoveryWordsError('checksum')
  }
}

/** Positions (from 0) of the words a user retypes to show they kept a copy, in reading order. */
export function pickCheckPositions(count = 3, random: () => number = Math.random): number[] {
  const positions = new Set<number>()
  while (positions.size < count) positions.add(Math.floor(random() * RECOVERY_WORD_COUNT))
  return [...positions].sort((a, b) => a - b)
}

export const sameRecoveryWord = (typed: string, word: string) => typed.trim().toLowerCase() === word
