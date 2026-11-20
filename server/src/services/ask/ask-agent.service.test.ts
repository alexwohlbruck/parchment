import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { Place } from '../../types/place.types'
import type {
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  LanguageModelCapability,
} from '../../types/language-model.types'

const mockLookupPlaces = mock(async () => [] as Place[])

mock.module('../place.service', () => ({
  lookupPlacesByNameAndLocation: mockLookupPlaces,
  lookupEnrichedPlaceById: mock(async () => null),
}))
mock.module('../search.service', () => ({
  searchByCategory: mock(async () => []),
  searchAlongRoute: mock(async () => []),
}))
mock.module('../category.service', () => ({
  categoryService: { searchCategories: () => [] },
}))
mock.module('../geocoding.service', () => ({
  forwardGeocode: mock(async () => ({ results: [] })),
}))
const mockClassify = mock((_query: string, _options: unknown): any => ({
  intent: 'ask',
  residual: '',
}))
mock.module('../query-intent.service', () => ({ classifyQuery: mockClassify }))
mock.module('../barrelman.service', () => ({
  requestBarrelman: mock(async () => new Response('{}')),
}))

const { runAsk, groundAnswer, MAX_STEPS } = await import('./ask-agent.service')
import type { AskContext } from './ask-tools'
import type { AskEvent } from '../../types/ask.types'

function place(id: string, name: string): Place {
  return {
    id,
    externalIds: {} as Place['externalIds'],
    name: { value: name, sourceId: 'osm' as any },
    description: null,
    placeType: { value: 'Café', sourceId: 'osm' as any },
    geometry: {
      value: { type: 'point', center: { lat: 40.7, lng: -74 } },
      sourceId: 'osm' as any,
    },
    photos: [],
    address: null,
    contactInfo: { phone: null, email: null, website: null, socials: {} },
    openingHours: null,
    amenities: {},
    sources: [],
    lastUpdated: '2026-11-14T00:00:00Z',
    createdAt: '2026-11-14T00:00:00Z',
  }
}

function call(name: string, args: object, id = name): ChatToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function scriptedModel(replies: ChatToolCall[][]) {
  const requests: ChatRequest[] = []
  const model: LanguageModelCapability = {
    async complete(request): Promise<ChatResponse> {
      requests.push({ ...request, messages: [...request.messages] })
      const tool_calls =
        replies[Math.min(requests.length - 1, replies.length - 1)]
      return { message: { role: 'assistant', content: null, tool_calls } }
    },
  }
  return { model, requests }
}

function context(): AskContext & { events: AskEvent[] } {
  const events: AskEvent[] = []
  return {
    userId: 'u1',
    language: 'en-US',
    origin: { lat: 40.7, lng: -74 },
    places: new Map(),
    units: 'metric',
    vehicles: [],
    now: new Date('2026-11-14T15:00:00Z'),
    seen: new Map(),
    routes: new Map(),
    sources: new Map(),
    emit: (event) => events.push(event),
    events,
  }
}

beforeEach(() => mockLookupPlaces.mockReset())

describe('groundAnswer', () => {
  test('drops places no tool returned and reports their ids', () => {
    const seen = new Map([['osm/node/1', place('osm/node/1', 'Real')]])
    const answer = groundAnswer(
      {
        text: ' Try Real. ',
        places: [
          { id: 'osm/node/1', reason: 'close' },
          { id: 'osm/node/9', reason: 'x' },
        ],
      },
      seen,
    )
    expect(answer.text).toBe('Try Real.')
    expect(answer.places.map(({ place }) => place.name.value)).toEqual(['Real'])
    expect(answer.unknownIds).toEqual(['osm/node/9'])
  })
})

describe('runAsk', () => {
  test('searches, rejects an invented place, then answers with real ones', async () => {
    mockLookupPlaces.mockResolvedValue([
      place('osm/node/1', 'Café One'),
      place('osm/node/2', 'Café Two'),
    ])
    const { model, requests } = scriptedModel([
      [call('find_places', { query: 'cafe' })],
      [
        call('answer', {
          text: 'Two nearby.',
          places: [
            { id: 'osm/node/1', reason: 'a' },
            { id: 'made/up', reason: 'b' },
          ],
        }),
      ],
      [
        call('answer', {
          text: 'Two nearby.',
          places: [
            { id: 'osm/node/2', reason: 'b' },
            { id: 'osm/node/1', reason: 'a' },
          ],
        }),
      ],
    ])
    const ctx = context()

    await runAsk(model, { question: 'coffee?' }, ctx)

    expect(
      ctx.events.filter((e) => e.type === 'step').map((e) => (e as any).status),
    ).toEqual(['running', 'done'])
    const answer = ctx.events.find((e) => e.type === 'answer') as Extract<
      AskEvent,
      { type: 'answer' }
    >
    expect(answer.places.map(({ place }) => place.id)).toEqual([
      'osm/node/2',
      'osm/node/1',
    ])
    expect(requests).toHaveLength(3)
    expect(requests[2].messages.at(-1)).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('made/up'),
    })
  })

  test('offers the question as a category list when it names one', async () => {
    const browse = {
      intent: 'ask',
      category: { id: 'amenity/cafe', name: 'Cafe' },
      residual: 'quiet',
    }
    mockClassify.mockReturnValueOnce(browse)
    const { model } = scriptedModel([
      [call('answer', { text: 'None fit.', places: [] })],
    ])
    const ctx = context()

    await runAsk(model, { question: 'quiet cafe' }, ctx)

    expect(ctx.events.at(-1)).toMatchObject({ type: 'answer', browse })
  })

  test('reads the subject place before the model starts', async () => {
    const { model, requests } = scriptedModel([
      [call('answer', { text: 'Yes.', places: [] })],
    ])
    const ctx = context()

    await runAsk(
      model,
      { question: 'good for working?', placeId: 'osm/node/7' },
      ctx,
    )

    expect(requests[0].messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'subject-place',
    })
    expect(ctx.events[0]).toMatchObject({ type: 'step', status: 'running' })
  })

  test('names the subject spot in the question', async () => {
    const { model, requests } = scriptedModel([
      [call('answer', { text: 'Yes.', places: [] })],
    ])

    await runAsk(
      model,
      { question: 'safe to park?', point: { lat: 40.71234, lng: -74.01, name: '12 Main St' } },
      context(),
    )

    expect(requests[0].messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'safe to park?\n\nThe question is about 12 Main St, at 40.71234, -74.01000.',
    })
  })

  test('forces an answer on the last step', async () => {
    mockLookupPlaces.mockResolvedValue([])
    const { model, requests } = scriptedModel([
      [call('find_places', { query: 'x' })],
    ])
    const ctx = context()

    await runAsk(model, { question: 'anything?' }, ctx)

    expect(requests).toHaveLength(MAX_STEPS)
    expect(requests.at(-1)!.tools!.map((tool) => tool.function.name)).toEqual([
      'answer',
    ])
  })

  test('reports a failed tool to the model instead of throwing', async () => {
    mockLookupPlaces.mockRejectedValue(new Error('upstream down'))
    const { model, requests } = scriptedModel([
      [call('find_places', { query: 'unreachable' })],
      [call('answer', { text: 'Search is down.', places: [] })],
    ])
    const ctx = context()

    await runAsk(model, { question: 'x?' }, ctx)

    expect(
      ctx.events.some((e) => e.type === 'step' && e.status === 'failed'),
    ).toBe(true)
    const reported = requests[1].messages.at(-1)
    expect(reported).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('search failed'),
    })
    expect(JSON.stringify(reported)).not.toContain('upstream down')
    expect(ctx.events.at(-1)).toMatchObject({ type: 'answer', places: [] })
  })
})
