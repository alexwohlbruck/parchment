import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse-events'

describe('createSseParser', () => {
  it('emits each data payload, including frames split across chunks', () => {
    const events: unknown[] = []
    const feed = createSseParser(event => events.push(event))
    feed('event: step\ndata: {"type":"step","id":"1"}\n\nevent: ans')
    feed('wer\ndata: {"type":"answer"')
    feed(',"text":"hi"}\n\n')
    expect(events).toEqual([
      { type: 'step', id: '1' },
      { type: 'answer', text: 'hi' },
    ])
  })
})
