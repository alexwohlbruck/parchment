import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { Place } from '../types/place.types'

const posted: { lat: number; lon: number; text: string }[] = []
let mapped = false
let openNotes: string[] = []
let token: string | null = 'osm-token'

mock.module('../config/osm.config', () => ({ getOsmConfig: () => ({ server: 'sandbox' }) }))
mock.module('./web-place.service', () => ({ mappedNamesake: async () => (mapped ? {} : undefined) }))
mock.module('./osm-account.service', () => ({
  osmAccountToken: async () => token,
  openOsmNoteTexts: async () => openNotes,
  postOsmNote: async (_token: string, lat: number, lon: number, text: string) => {
    posted.push({ lat, lon, text })
    return { properties: { id: 4242 } }
  },
}))

const { db } = await import('../db')
const { users } = await import('../schema/users.schema')
const { webPlaceListings } = await import('../schema/web-place-listings.schema')
const { generateId } = await import('../util')
const { listWebPlace, listedWebPlace, resolveWebPlace, noteExpiredListings } = await import('./web-place-listings.service')

const RUN = Math.random().toString(36).slice(2, 8)
let userId = ''

function place(name: string): Place {
  return {
    id: `web/${RUN}${name.replace(/\W/g, '').toLowerCase()}`,
    name: { value: name },
    geometry: { value: { type: 'point', center: { lat: 40.6036, lng: -73.9767 } } },
    unmapped: { tags: { name }, presetId: null, noteText: `${name} is missing from the map.` },
  } as unknown as Place
}

async function expire(id: string) {
  await db.update(webPlaceListings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(webPlaceListings.id, id))
}

async function listing(id: string) {
  const [row] = await db.select().from(webPlaceListings).where(eq(webPlaceListings.id, id))
  return row
}

beforeAll(async () => {
  userId = generateId()
  await db.insert(users).values({
    id: userId,
    email: `listing-${RUN}@parchment.test`,
    alias: `listing_${RUN}`,
    signingKey: 'sig',
    encryptionKey: 'enc',
  })
})

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId))
})

describe('web place listings', () => {
  test('a listed place opens until it expires', async () => {
    const bar = place('Homestretch Bar')
    await listWebPlace(bar, userId)
    expect((await listedWebPlace(bar.id))?.name.value).toBe('Homestretch Bar')
    await expire(bar.id)
    expect(await listedWebPlace(bar.id)).toBeNull()
  })

  test('an expired place no one added gets one note, from the finder’s account', async () => {
    const cafe = place('Cafe Wands')
    await listWebPlace(cafe, userId)
    await expire(cafe.id)
    posted.length = 0
    await noteExpiredListings()
    await noteExpiredListings()
    expect(posted.filter((note) => note.text === 'Cafe Wands is missing from the map.')).toHaveLength(1)
    expect(await listing(cafe.id)).toMatchObject({ resolution: 'auto-noted', noteId: 4242 })
  })

  test('an added or noted place gets no note', async () => {
    const added = place('Moss Cafe')
    const noted = place('Juno the Bakery')
    for (const p of [added, noted]) await listWebPlace(p, userId)
    await resolveWebPlace(added.id, 'added')
    await resolveWebPlace(noted.id, 'noted')
    for (const p of [added, noted]) await expire(p.id)
    posted.length = 0
    await noteExpiredListings()
    expect(posted).toHaveLength(0)
    expect((await listing(added.id)).resolution).toBe('added')
    expect((await listing(noted.id)).resolution).toBe('noted')
  })

  test('skips a place the map has gained, one already noted, or a finder without OSM', async () => {
    const cases = [
      { p: place('Smor Bakery'), set: () => { mapped = true }, expected: 'mapped' as const },
      { p: place('Librae Bakery'), set: () => { openNotes = ['librae bakery is missing from the map'] }, expected: 'already-noted' as const },
      { p: place('Dame'), set: () => { token = null }, expected: 'no-account' as const },
    ]
    for (const { p, set, expected } of cases) {
      mapped = false
      openNotes = []
      token = 'osm-token'
      set()
      await listWebPlace(p, userId)
      await expire(p.id)
      posted.length = 0
      await noteExpiredListings()
      expect(posted).toHaveLength(0)
      expect((await listing(p.id)).resolution).toBe(expected)
    }
  })
})
