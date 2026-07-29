/**
 * Unit tests for the per-user OpenStreetMap account integration.
 *
 * This one writes to OSM on the user's behalf — notes and changesets — so the
 * riskiest surface is the changeset XML builder. Tag keys and values come from
 * caller-supplied data and are interpolated straight into markup, so
 * `escapeXml` is what stands between a quote in a tag value and a malformed
 * (or injected) changeset. Every entity is covered below.
 *
 * The note adapter also has to handle both response shapes OSM returns:
 * flat `lat`/`lon` properties, and GeoJSON `geometry.coordinates`.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createAxiosMock, axiosError } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../config/osm.config', () => ({
  getOsmConfig: () => ({ apiBase: 'https://api.osm.test/api/0.6' }),
}))

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { OpenStreetMapIntegration } = await import('./openstreetmap-integration')

const validConfig = { accessToken: 'osm-token' }

/** An initialized integration plus its edit capability. */
function configured() {
  const integration = new OpenStreetMapIntegration()
  integration.initialize(validConfig)
  return integration.capabilities.osmMapEdit
}

const noteProperties = (over: Partial<any> = {}) => ({
  id: 4242,
  lat: 35.2,
  lon: -80.8,
  status: 'open',
  date_created: '2026-01-01 00:00:00 UTC',
  closed_at: null,
  comments: [
    {
      date: '2026-01-01 00:00:00 UTC',
      uid: 7,
      user: 'mapper',
      action: 'opened',
      text: 'Pothole here',
    },
  ],
  ...over,
})

const noteResponse = (over: Partial<any> = {}) => ({
  data: { properties: noteProperties(over) },
})

beforeEach(() => {
  http.reset()
})

describe('configuration', () => {
  test('requires an access token', () => {
    const integration = new OpenStreetMapIntegration()

    expect(integration.validateConfig(validConfig)).toBe(true)
    expect(integration.validateConfig({ accessToken: '' })).toBe(false)
    expect(integration.validateConfig(undefined as any)).toBe(false)
  })

  test('initialize refuses an empty token', () => {
    expect(() =>
      new OpenStreetMapIntegration().initialize({ accessToken: '' }),
    ).toThrow('access token is required')
  })

  test('declares the map-edit capability with every operation', () => {
    const integration = new OpenStreetMapIntegration()

    expect(integration.capabilityIds).toEqual(['osmMapEdit'])
    for (const op of [
      'createNote',
      'getNote',
      'commentOnNote',
      'closeNote',
      'createChangeset',
      'uploadChange',
      'closeChangeset',
    ]) {
      expect(typeof (integration.capabilities.osmMapEdit as any)[op]).toBe(
        'function',
      )
    }
  })

  test('refuses to act before initialization', async () => {
    const integration = new OpenStreetMapIntegration()

    await expect(
      integration.capabilities.osmMapEdit.getNote(1),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('testConnection', () => {
  test('rejects an empty token without a request', async () => {
    const result = await new OpenStreetMapIntegration().testConnection({
      accessToken: '',
    })

    expect(result.success).toBe(false)
    expect(http.get).not.toHaveBeenCalled()
  })

  test('greets the authenticated user by name', async () => {
    http.get.mockResolvedValueOnce({ data: { user: { display_name: 'mapper' } } })

    const result = await new OpenStreetMapIntegration().testConnection(
      validConfig,
    )

    expect(result.success).toBe(true)
    expect(result.message).toBe('Connected as mapper')
  })

  test('sends the token as a bearer header', async () => {
    http.get.mockResolvedValueOnce({ data: { user: { display_name: 'mapper' } } })

    await new OpenStreetMapIntegration().testConnection(validConfig)

    expect(http.get.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer osm-token',
    )
  })

  test('reports an expired token distinctly on 401', async () => {
    http.get.mockRejectedValueOnce(axiosError(401, 'unauthorized'))

    const result = await new OpenStreetMapIntegration().testConnection(
      validConfig,
    )

    expect(result.message).toBe('Access token is invalid or expired')
  })

  test('reports an unexpected body shape', async () => {
    http.get.mockResolvedValueOnce({ data: {} })

    const result = await new OpenStreetMapIntegration().testConnection(
      validConfig,
    )

    expect(result).toEqual({
      success: false,
      message: 'Unexpected response from OSM API',
    })
  })

  test('surfaces a network failure message', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    const result = await new OpenStreetMapIntegration().testConnection(
      validConfig,
    )

    expect(result.message).toBe('ETIMEDOUT')
  })
})

describe('notes', () => {
  test('creates a note at the given coordinates', async () => {
    http.post.mockResolvedValueOnce(noteResponse())

    const note = await configured().createNote(35.2, -80.8, 'Pothole here')

    expect(note.id).toBe(4242)
    const [url, body, config] = http.post.mock.calls[0]
    expect(url).toBe('https://api.osm.test/api/0.6/notes.json')
    expect(body).toBeNull()
    expect(config.params).toEqual({ lat: 35.2, lon: -80.8, text: 'Pothole here' })
  })

  test('sends lng as OSM’s lon parameter', async () => {
    http.post.mockResolvedValueOnce(noteResponse())

    await configured().createNote(1, 2, 'x')

    expect(http.post.mock.calls[0][2].params.lon).toBe(2)
  })

  test('fetches a note by id', async () => {
    http.get.mockResolvedValueOnce(noteResponse())

    await configured().getNote(4242)

    expect(http.get.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242.json',
    )
  })

  test('comments on a note', async () => {
    http.post.mockResolvedValueOnce(noteResponse())

    await configured().commentOnNote(4242, 'Still there')

    expect(http.post.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242/comment.json',
    )
    expect(http.post.mock.calls[0][2].params).toEqual({ text: 'Still there' })
  })

  test('closes a note with an optional comment', async () => {
    http.post.mockResolvedValueOnce(noteResponse({ status: 'closed' }))

    await configured().closeNote(4242, 'Fixed')

    expect(http.post.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/notes/4242/close.json',
    )
    expect(http.post.mock.calls[0][2].params).toEqual({ text: 'Fixed' })
  })

  test('omits params entirely when closing with no comment', async () => {
    http.post.mockResolvedValueOnce(noteResponse({ status: 'closed' }))

    await configured().closeNote(4242)

    expect(http.post.mock.calls[0][2].params).toBeUndefined()
  })

  test('authenticates every note call', async () => {
    http.get.mockResolvedValueOnce(noteResponse())

    await configured().getNote(4242)

    expect(http.get.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer osm-token',
    )
  })
})

describe('note adaptation', () => {
  test('maps the flat lat/lon shape', async () => {
    http.get.mockResolvedValueOnce(noteResponse())

    const note = await configured().getNote(4242)

    expect(note).toMatchObject({
      id: 4242,
      lat: 35.2,
      lng: -80.8,
      status: 'open',
      createdAt: '2026-01-01 00:00:00 UTC',
      closedAt: null,
    })
  })

  test('falls back to GeoJSON coordinates', async () => {
    // OSM returns both shapes depending on the endpoint.
    http.get.mockResolvedValueOnce({
      data: {
        properties: noteProperties({
          lat: undefined,
          lon: undefined,
          geometry: { coordinates: [-80.9, 35.3] },
        }),
      },
    })

    const note = await configured().getNote(4242)

    expect(note.lat).toBe(35.3)
    expect(note.lng).toBe(-80.9)
  })

  test('maps the comment thread', async () => {
    http.get.mockResolvedValueOnce(noteResponse())

    const note = await configured().getNote(4242)

    expect(note.comments).toEqual([
      {
        date: '2026-01-01 00:00:00 UTC',
        uid: 7,
        user: 'mapper',
        action: 'opened',
        text: 'Pothole here',
      },
    ])
  })

  test('handles a note with no comments', async () => {
    http.get.mockResolvedValueOnce(
      { data: { properties: noteProperties({ comments: undefined }) } },
    )

    expect((await configured().getNote(4242)).comments).toEqual([])
  })
})

describe('changesets', () => {
  test('builds changeset XML from the supplied tags', async () => {
    http.put.mockResolvedValueOnce({ data: '12345' })

    const id = await configured().createChangeset({
      created_by: 'Parchment',
      comment: 'Fix a name',
    })

    expect(id).toBe(12345)
    const [url, body, config] = http.put.mock.calls[0]
    expect(url).toBe('https://api.osm.test/api/0.6/changeset/create')
    expect(body).toBe(
      '<osm><changeset><tag k="created_by" v="Parchment"/><tag k="comment" v="Fix a name"/></changeset></osm>',
    )
    expect(config.headers['Content-Type']).toBe('text/xml')
  })

  test('parses the changeset id from the plain-text response', async () => {
    http.put.mockResolvedValueOnce({ data: '98765\n' })

    expect(await configured().createChangeset({})).toBe(98765)
  })

  test('handles a changeset with no tags', async () => {
    http.put.mockResolvedValueOnce({ data: '1' })

    await configured().createChangeset({})

    expect(http.put.mock.calls[0][1]).toBe('<osm><changeset></changeset></osm>')
  })

  test('escapes every XML entity in tag values', () => {
    // A quote or ampersand in a comment would otherwise produce malformed —
    // or attacker-shaped — markup.
    return configured()
      .createChangeset({ comment: `Tom & "Jerry" <b>'s</b>` })
      .catch(() => {})
      .then(() => {
        const body = http.put.mock.calls[0][1] as string
        expect(body).toContain('&amp;')
        expect(body).toContain('&quot;')
        expect(body).toContain('&lt;b&gt;')
        expect(body).toContain('&apos;')
        // No raw delimiters survive inside the value.
        expect(body).not.toContain('"Jerry"')
        expect(body).not.toContain('<b>')
      })
  })

  test('escapes tag KEYS as well as values', async () => {
    http.put.mockResolvedValueOnce({ data: '1' })

    await configured().createChangeset({ 'we<ird': 'value' })

    expect(http.put.mock.calls[0][1]).toContain('k="we&lt;ird"')
  })

  test('uploads an osmChange document as XML', async () => {
    http.post.mockResolvedValueOnce({ data: '' })

    await configured().uploadChange(12345, '<osmChange/>')

    const [url, body, config] = http.post.mock.calls[0]
    expect(url).toBe('https://api.osm.test/api/0.6/changeset/12345/upload')
    expect(body).toBe('<osmChange/>')
    expect(config.headers['Content-Type']).toBe('text/xml')
  })

  test('closes a changeset', async () => {
    http.put.mockResolvedValueOnce({ data: '' })

    await configured().closeChangeset(12345)

    expect(http.put.mock.calls[0][0]).toBe(
      'https://api.osm.test/api/0.6/changeset/12345/close',
    )
    expect(http.put.mock.calls[0][1]).toBeNull()
  })

  test('authenticates changeset calls', async () => {
    http.put.mockResolvedValueOnce({ data: '1' })

    await configured().createChangeset({})

    expect(http.put.mock.calls[0][2].headers.Authorization).toBe(
      'Bearer osm-token',
    )
  })
})
