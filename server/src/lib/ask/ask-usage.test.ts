import { describe, test, expect } from 'bun:test'
import {
  DEFAULT_MONTHLY_QUESTIONS,
  meterModel,
  monthResetsAt,
  monthlyQuestionAllowance,
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

describe('monthlyQuestionAllowance', () => {
  test('reads a whole number, 0 included', () => {
    expect(monthlyQuestionAllowance('50')).toBe(50)
    expect(monthlyQuestionAllowance('0')).toBe(0)
  })

  test('falls back to the default when unset or invalid', () => {
    for (const value of [undefined, '', 'lots', '-3', '2.5']) {
      expect(monthlyQuestionAllowance(value)).toBe(DEFAULT_MONTHLY_QUESTIONS)
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
