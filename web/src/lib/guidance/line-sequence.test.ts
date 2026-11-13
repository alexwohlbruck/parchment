import { describe, expect, it } from 'vitest'
import { lineSequence } from './line-sequence'

const t = (_key: string, p: Record<string, unknown>) => `${p.lines}, then the ${p.line}`

describe('lineSequence', () => {
  it('names a single line on its own', () => expect(lineSequence(['A'], t)).toBe('A'))
  it('chains several lines in order', () => expect(lineSequence(['A', 'F', '7'], t)).toBe('A, then the F, then the 7'))
  it('skips unnamed lines', () => expect(lineSequence(['', 'F', ''], t)).toBe('F'))
  it('is empty with no named lines', () => expect(lineSequence([''], t)).toBe(''))
})
