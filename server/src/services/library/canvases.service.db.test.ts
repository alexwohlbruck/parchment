/**
 * Tests for the canvases service's scheme switch.
 *
 * The property worth a real database behind it is that exactly one side of a
 * canvas is ever populated: going private has to leave no readable name or
 * body behind, and coming back has to leave no envelope. A `.set()` that
 * forgets one column would be a privacy bug that no type check catches.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { users } from '../../schema/users.schema'
import { canvases } from '../../schema/canvases.schema'
import { generateId } from '../../util'
import {
  changeCanvasScheme,
  createCanvas,
  createPublicLink,
  deleteCanvas,
  getCanvasById,
  getPublicCanvasByToken,
  revokePublicLink,
  updateCanvas,
  PublicLinkNotAllowedOnE2eeError,
  SchemeAlreadySetError,
} from './canvases.service'

const userId = `canvas-test-${generateId()}`

beforeAll(async () => {
  await db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    firstName: 'Canvas',
  })
})

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId))
})

async function seedServerKey() {
  const canvas = await createCanvas({ userId, scheme: 'server-key' })
  await updateCanvas(canvas.id, userId, {
    name: 'Weekend ride',
    description: 'Cafés worth the detour',
    icon: 'MapIcon',
    iconColor: 'iris',
    body: { layers: [{ id: 'a', kind: 'library', layerId: 'l1', visible: true }] },
  })
  return canvas.id
}

describe('updateCanvas', () => {
  test('answers without the document it was just handed', async () => {
    const id = await seedServerKey()

    const updated = await updateCanvas(id, userId, { name: 'Sunday ride' })

    // A canvas saves itself as it is edited, so the body it just sent is the
    // one thing the client already holds — echoing it doubled every save.
    expect(updated?.name).toBe('Sunday ride')
    expect(updated).not.toHaveProperty('body')
    expect(updated).not.toHaveProperty('bodyEncrypted')
    // And it is still there to be read back.
    expect((await getCanvasById(id, userId))?.body).toEqual({
      layers: [{ id: 'a', kind: 'library', layerId: 'l1', visible: true }],
    })

    await deleteCanvas(id, userId)
  })
})

describe('changeCanvasScheme', () => {
  test('going private clears every cleartext column', async () => {
    const id = await seedServerKey()

    await changeCanvasScheme({
      canvasId: id,
      userId,
      targetScheme: 'user-e2ee',
      metadataEncrypted: 'metadata-envelope',
      bodyEncrypted: 'body-envelope',
    })

    const row = await getCanvasById(id, userId)
    expect(row?.scheme).toBe('user-e2ee')
    expect(row?.name).toBeNull()
    expect(row?.description).toBeNull()
    expect(row?.icon).toBeNull()
    expect(row?.iconColor).toBeNull()
    expect(row?.body).toBeNull()
    expect(row?.metadataEncrypted).toBe('metadata-envelope')
    expect(row?.bodyEncrypted).toBe('body-envelope')

    await deleteCanvas(id, userId)
  })

  test('going private revokes a public link the server can no longer honour', async () => {
    const id = await seedServerKey()
    await db
      .update(canvases)
      .set({ isPublic: true, publicToken: `tok-${generateId()}`, publicRole: 'viewer' })
      .where(eq(canvases.id, id))

    await changeCanvasScheme({
      canvasId: id,
      userId,
      targetScheme: 'user-e2ee',
      metadataEncrypted: 'envelope',
      bodyEncrypted: 'envelope',
    })

    const row = await getCanvasById(id, userId)
    expect(row?.isPublic).toBe(false)
    expect(row?.publicToken).toBeNull()
    expect(row?.publicRole).toBeNull()

    await deleteCanvas(id, userId)
  })

  test('coming back to shareable clears both envelopes', async () => {
    const canvas = await createCanvas({ userId, scheme: 'user-e2ee' })
    await updateCanvas(canvas.id, userId, {
      metadataEncrypted: 'metadata-envelope',
      bodyEncrypted: 'body-envelope',
    })

    await changeCanvasScheme({
      canvasId: canvas.id,
      userId,
      targetScheme: 'server-key',
      name: 'Weekend ride',
      body: { layers: [] },
    })

    const row = await getCanvasById(canvas.id, userId)
    expect(row?.scheme).toBe('server-key')
    expect(row?.metadataEncrypted).toBeNull()
    expect(row?.bodyEncrypted).toBeNull()
    expect(row?.name).toBe('Weekend ride')
    expect(row?.body).toEqual({ layers: [] })

    await deleteCanvas(canvas.id, userId)
  })

  test('refuses a switch to the scheme already in use', async () => {
    const id = await seedServerKey()

    await expect(
      changeCanvasScheme({ canvasId: id, userId, targetScheme: 'server-key' }),
    ).rejects.toBeInstanceOf(SchemeAlreadySetError)

    await deleteCanvas(id, userId)
  })

  test('reports another user’s canvas as missing rather than switching it', async () => {
    const id = await seedServerKey()

    const result = await changeCanvasScheme({
      canvasId: id,
      userId: 'someone-else',
      targetScheme: 'user-e2ee',
    })

    expect(result).toBeUndefined()
    expect((await getCanvasById(id, userId))?.scheme).toBe('server-key')

    await deleteCanvas(id, userId)
  })
})

describe('public links', () => {
  test('mints a token on a shareable canvas and resolves it back', async () => {
    const id = await seedServerKey()

    const link = await createPublicLink(id, userId)
    expect(link?.publicRole).toBe('viewer')

    const resolved = await getPublicCanvasByToken(link!.publicToken)
    expect(resolved?.id).toBe(id)
    expect(resolved?.name).toBe('Weekend ride')

    await deleteCanvas(id, userId)
  })

  test('is idempotent, so re-opening the dialog does not rotate the URL', async () => {
    const id = await seedServerKey()

    const first = await createPublicLink(id, userId)
    const second = await createPublicLink(id, userId)

    expect(second?.publicToken).toBe(first!.publicToken)

    await deleteCanvas(id, userId)
  })

  test('refuses a private canvas, which the server could not render', async () => {
    const canvas = await createCanvas({ userId, scheme: 'user-e2ee' })

    await expect(createPublicLink(canvas.id, userId)).rejects.toBeInstanceOf(
      PublicLinkNotAllowedOnE2eeError,
    )

    await deleteCanvas(canvas.id, userId)
  })

  test('a revoked token stops resolving', async () => {
    const id = await seedServerKey()
    const link = await createPublicLink(id, userId)

    expect(await revokePublicLink(id, userId)).toBe(true)
    expect(await getPublicCanvasByToken(link!.publicToken)).toBeNull()

    await deleteCanvas(id, userId)
  })

  test('a token stops resolving once the canvas is made private', async () => {
    const id = await seedServerKey()
    const link = await createPublicLink(id, userId)

    await changeCanvasScheme({
      canvasId: id,
      userId,
      targetScheme: 'user-e2ee',
      metadataEncrypted: 'envelope',
      bodyEncrypted: 'envelope',
    })

    expect(await getPublicCanvasByToken(link!.publicToken)).toBeNull()

    await deleteCanvas(id, userId)
  })

  test('will not mint a link on someone else’s canvas', async () => {
    const id = await seedServerKey()

    expect(await createPublicLink(id, 'someone-else')).toBeNull()

    await deleteCanvas(id, userId)
  })
})
