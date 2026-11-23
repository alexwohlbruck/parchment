/** Lower-case words with accents stripped, for matching typed text against names. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function everyTokenPrefixes(tokens: string[], words: string[]): boolean {
  return tokens.every(t => words.some(w => w.startsWith(t)))
}
