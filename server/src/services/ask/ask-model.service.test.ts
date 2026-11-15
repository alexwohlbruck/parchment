import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { LanguageModelCapability } from '../../types/language-model.types'

const ownModel: LanguageModelCapability = { complete: async () => ({ message: { role: 'assistant', content: '' } }) }
const systemModel: LanguageModelCapability = { complete: async () => ({ message: { role: 'assistant', content: '' } }) }

let records: { userId: string | null; model: LanguageModelCapability }[] = []
let permitted = true
const asked = new Map<string, number>()
const mockQuestionsAsked = mock(async (userId: string, keySource: string, at: Date) =>
  asked.get(`${userId}:${keySource}:${at.toISOString().slice(0, 7)}`) ?? 0,
)

mock.module('../integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => records,
    getCachedIntegrationInstance: (record: { model: LanguageModelCapability }) => ({
      capabilities: { languageModel: record.model },
    }),
  },
}))
mock.module('../auth.service', () => ({
  getPermissions: async () => [],
  hasPermission: () => permitted,
}))
mock.module('./ask-usage.service', () => ({ questionsAsked: mockQuestionsAsked }))

delete process.env.OPENROUTER_API_KEY
const { resolveAskAccess } = await import('./ask-model.service')

const NOV = new Date('2026-11-14T12:00:00Z')
const DEC = new Date('2026-12-01T00:00:00Z')

describe('resolveAskAccess', () => {
  beforeEach(() => {
    records = [{ userId: null, model: systemModel }]
    permitted = true
    asked.clear()
    mockQuestionsAsked.mockClear()
    delete process.env.ASK_MONTHLY_QUESTIONS
  })

  test('an own key is never limited or counted', async () => {
    records.push({ userId: 'u1', model: ownModel })
    asked.set('u1:system:2026-11', 10_000)
    const access = await resolveAskAccess('u1', NOV)
    expect(access).toEqual({ allowed: true, model: ownModel, keySource: 'own' })
    expect(mockQuestionsAsked).not.toHaveBeenCalled()
  })

  test('the system key reports what is left this month', async () => {
    asked.set('u1:system:2026-11', 38)
    const access = await resolveAskAccess('u1', NOV)
    expect(access).toEqual({
      allowed: true,
      model: systemModel,
      keySource: 'system',
      quota: { used: 38, limit: 200, remaining: 162, resetsAt: '2026-12-01T00:00:00.000Z' },
    })
  })

  test('a used-up allowance is refused until the next month', async () => {
    process.env.ASK_MONTHLY_QUESTIONS = '5'
    asked.set('u1:system:2026-11', 5)
    expect(await resolveAskAccess('u1', NOV)).toEqual({
      allowed: false,
      reason: 'quota-exceeded',
      resetsAt: '2026-12-01T00:00:00.000Z',
    })

    const next = await resolveAskAccess('u1', DEC)
    expect(next.allowed && next.keySource === 'system' && next.quota).toEqual({
      used: 0,
      limit: 5,
      remaining: 5,
      resetsAt: '2027-01-01T00:00:00.000Z',
    })
  })

  test('a zero allowance means no limit', async () => {
    process.env.ASK_MONTHLY_QUESTIONS = '0'
    asked.set('u1:system:2026-11', 10_000)
    const access = await resolveAskAccess('u1', NOV)
    expect(access).toMatchObject({ allowed: true, keySource: 'system', quota: null })
    expect(mockQuestionsAsked).not.toHaveBeenCalled()
  })

  test('the permission is checked before the allowance', async () => {
    permitted = false
    expect(await resolveAskAccess('u1', NOV)).toEqual({ allowed: false, reason: 'not-permitted' })
  })
})
