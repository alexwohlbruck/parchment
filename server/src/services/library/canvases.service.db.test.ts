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
  deleteCanvas,
  getCanvasById,
  updateCanvas,
  SchemeAlreadySetError,
} from './canvases.service'

const userId = `canvas-test-${generateId()}`

beforeAll(async () => {
  await db.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    name: 'Canvas Test',
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
