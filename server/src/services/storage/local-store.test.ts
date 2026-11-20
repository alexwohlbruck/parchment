import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLocalStore } from './local-store'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'local-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createLocalStore', () => {
  test('stores, reads back and deletes a blob', async () => {
    const store = createLocalStore(root)
    await store.put('avatars/u1/a.webp', new Uint8Array([1, 2, 3]), 'image/webp')

    const blob = await store.get('avatars/u1/a.webp')
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(blob!.type).toBe('image/webp')

    await store.delete('avatars/u1/a.webp')
    expect(await store.get('avatars/u1/a.webp')).toBeNull()
  })

  test('deleting a missing key is a no-op', async () => {
    await expect(createLocalStore(root).delete('avatars/none.webp')).resolves.toBeUndefined()
  })

  test('refuses keys that escape the root', async () => {
    const store = createLocalStore(root)
    await expect(store.get('../outside')).rejects.toThrow('Invalid storage key')
    await expect(store.put('a/../../outside', new Uint8Array(), 'text/plain')).rejects.toThrow()
  })
})
