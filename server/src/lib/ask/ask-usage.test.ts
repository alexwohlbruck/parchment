import { describe, test, expect } from 'bun:test'
import {
  meterModel,
  monthResetsAt,
  questionAllowance,
  usageMonth,
} from './ask-usage'
import type { ChatUsage } from '../../types/language-model.types'

describe('usage month', () => {
  test('counts by UTC month and resets at the next one', () => {
    const lateDec = new Date('2026-12-31T23:30:00-05:00')
    expect(usageMonth(lateDec)).toBe('2027-01')
    expect(usageMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
    expect(monthResetsAt(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('questionAllowance', () => {
  test('gives each plan its own allowance, the best one held winning', () => {
    expect(questionAllowance(['ask:trial'], {})).toBe(5)
    expect(questionAllowance(['ask:trial', 'ask:basic'], {})).toBe(50)
    expect(questionAllowance(['ask:basic', 'premium:ask'], {})).toBe(1000)
  })

  test('no allowance without an Ask permission', () => {
    expect(questionAllowance(['library:read'], {})).toBeNull()
  })

  test('reads each allowance from the environment, 0 as unlimited', () => {
    expect(questionAllowance(['ask:trial'], { ASK_QUESTIONS_TRIAL: '3' })).toBe(3)
    expect(questionAllowance(['ask:basic', 'premium:ask'], { ASK_QUESTIONS_PREMIUM: '0' })).toBe(0)
  })

  test('ignores an invalid setting', () => {
    for (const value of ['', 'lots', '-3', '2.5']) {
      expect(questionAllowance(['ask:basic'], { ASK_QUESTIONS_BASIC: value })).toBe(50)
    }
  })
})

describe('meterModel', () => {
  test('adds up usage across calls, cost only when reported', async () => {
    const usages: (ChatUsage | undefined)[] = [
      { promptTokens: 100, completionTokens: 20, cost: 0.001 },
      undefined,
      { promptTokens: 50, completionTokens: 5 },
    ]
    const { model, totals } = meterModel({
      complete: async () => ({ message: { role: 'assistant', content: '' }, usage: usages.shift() }),
    })
    for (let i = 0; i < 3; i++) await model.complete({ messages: [] })
    expect(totals).toEqual({ promptTokens: 150, completionTokens: 25, cost: 0.001 })
  })
})
