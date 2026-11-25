import { describe, expect, it } from 'vitest'
import {
  COMMAND_USE_LIMIT,
  commandWeights,
  recordCommandUse,
  suggestCommands,
  type CommandUse,
} from './command-usage'

const DAY = 86_400_000
const NOW = 100 * DAY

const command = (id: string) => ({ id })

describe('recordCommandUse', () => {
  it('keeps only the most recent uses', () => {
    let uses: CommandUse[] = []
    for (let i = 0; i < COMMAND_USE_LIMIT + 5; i++) {
      uses = recordCommandUse(uses, `c${i}`, i)
    }
    expect(uses).toHaveLength(COMMAND_USE_LIMIT)
    expect(uses[0].id).toBe('c5')
    expect(uses.at(-1)!.id).toBe(`c${COMMAND_USE_LIMIT + 4}`)
  })
})

describe('commandWeights', () => {
  it('sums uses, discounting each by its age in days', () => {
    const weights = commandWeights(
      [
        { id: 'a', at: NOW },
        { id: 'a', at: NOW - DAY },
        { id: 'b', at: NOW - 3 * DAY },
      ],
      NOW,
    )
    expect(weights.get('a')).toBeCloseTo(1.5)
    expect(weights.get('b')).toBeCloseTo(0.25)
  })
})

describe('suggestCommands', () => {
  const commands = ['theme', 'goto', 'terrain', 'labels'].map(command)

  it('ranks by weight and leaves out commands never used', () => {
    const uses = [
      { id: 'goto', at: NOW - 10 * DAY },
      { id: 'theme', at: NOW },
    ]
    expect(suggestCommands(commands, uses, NOW).map(c => c.id)).toEqual([
      'theme',
      'goto',
    ])
  })

  it('lets frequent use outweigh a single recent one', () => {
    const uses = [
      ...Array.from({ length: 4 }, () => ({ id: 'labels', at: NOW - 2 * DAY })),
      { id: 'terrain', at: NOW },
    ]
    expect(suggestCommands(commands, uses, NOW)[0].id).toBe('labels')
  })

  it('stops at the limit', () => {
    const uses = commands.map(c => ({ id: c.id, at: NOW }))
    expect(suggestCommands(commands, uses, NOW, 2)).toHaveLength(2)
  })

  it('ignores uses of commands not offered', () => {
    expect(suggestCommands(commands, [{ id: 'gone', at: NOW }], NOW)).toEqual([])
  })
})
