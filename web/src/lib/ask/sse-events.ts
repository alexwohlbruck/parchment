/**
 * Splits a Server-Sent Events byte stream into the JSON payloads of its
 * `data:` lines. Frames may arrive split across chunks, so the tail of each
 * chunk is carried into the next.
 */
export function createSseParser<T>(onEvent: (event: T) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (data) onEvent(JSON.parse(data) as T)
    }
  }
}
