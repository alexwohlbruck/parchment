import { describe, test, expect } from 'bun:test'
import { TransitGate, TransitPriority, retryAfterMs, rejectionRetryMs } from './transit-gate'

const refused = (retryAfter?: string) =>
  Object.assign(new Error('429'), {
    response: { status: 429, headers: retryAfter == null ? {} : { 'retry-after': retryAfter } },
  })

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const noSleep = { maxRetries: 3, maxRetryWaitMs: 5000, sleep: async () => {} }

describe('TransitGate', () => {
  test('holds requests past the concurrency limit until a slot frees', async () => {
    const gate = new TransitGate({ concurrency: 2, ...noSleep })
    const blockers = [deferred(), deferred()]
    const first = blockers.map((b) => gate.run(TransitPriority.Core, () => b.promise))
    let thirdStarted = false
    const third = gate.run(TransitPriority.Core, async () => {
      thirdStarted = true
    })
    await Promise.resolve()
    expect(gate.inFlight).toBe(2)
    expect(gate.waiting).toBe(1)
    expect(thirdStarted).toBe(false)

    blockers[0].resolve()
    await Promise.all([first[0], third])
    expect(thirdStarted).toBe(true)
    blockers[1].resolve()
    await first[1]
    expect(gate.inFlight).toBe(0)
  })

  test('admits the core query ahead of variants queued before it', async () => {
    const gate = new TransitGate({ concurrency: 1, ...noSleep })
    const blocker = deferred()
    const held = gate.run(TransitPriority.Core, () => blocker.promise)
    const order: string[] = []
    const variant = gate.run(TransitPriority.Variant, async () => void order.push('variant'))
    const enrich = gate.run(TransitPriority.Enrichment, async () => void order.push('enrich'))
    const core = gate.run(TransitPriority.Core, async () => void order.push('core'))
    blocker.resolve()
    await Promise.all([held, variant, enrich, core])
    expect(order).toEqual(['core', 'enrich', 'variant'])
  })

  test('retries a refused request after the Retry-After hint', async () => {
    const waits: number[] = []
    const gate = new TransitGate({
      concurrency: 4,
      maxRetries: 3,
      maxRetryWaitMs: 5000,
      sleep: async (ms) => void waits.push(ms),
    })
    let calls = 0
    const result = await gate.run(TransitPriority.Core, async () => {
      if (++calls < 3) throw refused('2')
      return 'itineraries'
    })
    expect(result).toBe('itineraries')
    expect(waits).toEqual([2000, 2000])
    expect(gate.inFlight).toBe(0)
  })

  test('gives up after the retry budget and surfaces the refusal', async () => {
    const gate = new TransitGate({ concurrency: 4, ...noSleep, maxRetries: 2 })
    let calls = 0
    await expect(
      gate.run(TransitPriority.Variant, async () => {
        calls++
        throw refused('1')
      }),
    ).rejects.toThrow('429')
    expect(calls).toBe(3)
    expect(gate.inFlight).toBe(0)
  })

  test('does not retry failures a retry cannot fix', async () => {
    const gate = new TransitGate({ concurrency: 4, ...noSleep })
    let calls = 0
    await expect(
      gate.run(TransitPriority.Core, async () => {
        calls++
        throw Object.assign(new Error('bad request'), { response: { status: 400 } })
      }),
    ).rejects.toThrow('bad request')
    expect(calls).toBe(1)
  })

  test('caps a long Retry-After wait', async () => {
    const waits: number[] = []
    const gate = new TransitGate({
      concurrency: 0,
      maxRetries: 1,
      maxRetryWaitMs: 3000,
      sleep: async (ms) => void waits.push(ms),
    })
    let calls = 0
    await gate.run(TransitPriority.Core, async () => {
      if (++calls === 1) throw refused('60')
    })
    expect(waits).toEqual([3000])
  })
})

describe('retryAfterMs', () => {
  test('reads delay-seconds', () => {
    expect(retryAfterMs('3')).toBe(3000)
  })

  test('reads an HTTP date', () => {
    const now = Date.parse('2026-10-15T12:00:00Z')
    expect(retryAfterMs('Thu, 15 Oct 2026 12:00:05 GMT', now)).toBe(5000)
  })

  test('falls back to a second without a usable hint', () => {
    expect(retryAfterMs(undefined)).toBe(1000)
    expect(retryAfterMs('soon')).toBe(1000)
  })

  test('only 429 is a retryable refusal', () => {
    expect(rejectionRetryMs(refused('1'))).toBe(1000)
    expect(rejectionRetryMs(new Error('timeout'))).toBeNull()
  })
})
