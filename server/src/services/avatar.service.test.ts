import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { createDbMock } from '../test/db-mock'

const root = await mkdtemp(join(tmpdir(), 'avatars-'))
mock.module('../config/storage.config', () => ({
  storage: { driver: 'local', localDir: root, publicUrl: 'https://cdn.test', s3: {} },
}))

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const profileUpdates: Array<{ userId: string; picture: string | null | undefined }> = []
mock.module('./user.service', () => ({
  updateUserDisplayProfile: async (userId: string, fields: { picture?: string | null }) => {
    profileUpdates.push({ userId, picture: fields.picture })
  },
}))

const { setAvatar, removeAvatar, migrateLegacyAvatars, UnreadableImageError } = await import(
  './avatar.service'
)
const { blobStore } = await import('./storage/storage.service')

const image = (width: number, height: number, background = '#3366ff') =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer()

const keyOf = (url: string) => url.replace('https://cdn.test/', '')

beforeEach(() => {
  dbMock.reset()
  profileUpdates.length = 0
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('setAvatar', () => {
  test('stores a 256px square webp and sets it as the picture', async () => {
    dbMock.queueSelect([{ picture: null }])

    const picture = await setAvatar('u1', await image(800, 400))

    expect(picture).toMatch(/^https:\/\/cdn\.test\/avatars\/u1\/[0-9a-f]{16}\.webp$/)
    expect(profileUpdates).toEqual([{ userId: 'u1', picture }])
    const stored = await blobStore.get(keyOf(picture))
    const meta = await sharp(Buffer.from(await stored!.arrayBuffer())).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 })
  })

  test('deletes the avatar it replaces', async () => {
    dbMock.queueSelect([{ picture: null }])
    const first = await setAvatar('u2', await image(300, 300))
    dbMock.queueSelect([{ picture: first }])
    const second = await setAvatar('u2', await image(300, 300, '#ff6633'))

    expect(second).not.toBe(first)
    expect(await blobStore.get(keyOf(first))).toBeNull()
    expect(await blobStore.get(keyOf(second))).not.toBeNull()
  })

  test('never deletes a file outside the caller’s own folder', async () => {
    dbMock.queueSelect([{ picture: null }])
    const theirs = await setAvatar('victim', await image(100, 100))
    dbMock.queueSelect([{ picture: theirs }])
    await setAvatar('attacker', await image(100, 100, '#ff6633'))

    expect(await blobStore.get(keyOf(theirs))).not.toBeNull()
  })

  test('rejects data that is not an image', async () => {
    dbMock.queueSelect([{ picture: null }])
    await expect(setAvatar('u3', new Uint8Array([1, 2, 3]))).rejects.toThrow(UnreadableImageError)
    expect(profileUpdates).toHaveLength(0)
  })

  test('rejects formats outside JPEG, PNG and WebP', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    )
    const tiff = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .tiff()
      .toBuffer()
    for (const input of [svg, tiff]) {
      await expect(setAvatar('u4', new Uint8Array(input))).rejects.toThrow(UnreadableImageError)
    }
    expect(profileUpdates).toHaveLength(0)
  })
})

describe('removeAvatar', () => {
  test('clears the picture and deletes the file', async () => {
    dbMock.queueSelect([{ picture: null }])
    const picture = await setAvatar('u4', await image(100, 100))
    profileUpdates.length = 0
    dbMock.queueSelect([{ picture }])

    await removeAvatar('u4')

    expect(profileUpdates).toEqual([{ userId: 'u4', picture: null }])
    expect(await blobStore.get(keyOf(picture))).toBeNull()
  })

  test('leaves external pictures alone', async () => {
    dbMock.queueSelect([{ picture: 'https://github.com/someone.png' }])

    await removeAvatar('u5')

    expect(profileUpdates).toEqual([{ userId: 'u5', picture: null }])
  })
})

describe('migrateLegacyAvatars', () => {
  test('moves a legacy file into the store and points the picture at it', async () => {
    await mkdir(join(root, 'avatars'), { recursive: true })
    const legacyPath = join(root, 'avatars', 'old.webp')
    await Bun.write(legacyPath, await sharp(await image(256, 256)).webp().toBuffer())
    dbMock.queueSelect([{ id: 'old', picture: '/users/old/avatar' }])

    await migrateLegacyAvatars()

    const picture = (dbMock.updated[0] as { picture: string }).picture
    expect(picture).toMatch(/^https:\/\/cdn\.test\/avatars\/old\/[0-9a-f]{16}\.webp$/)
    expect(await blobStore.get(keyOf(picture))).not.toBeNull()
    expect(await Bun.file(legacyPath).exists()).toBe(false)
  })

  test('clears a legacy picture whose file is gone', async () => {
    dbMock.queueSelect([{ id: 'gone', picture: '/users/gone/avatar' }])

    await migrateLegacyAvatars()

    expect(dbMock.updated).toEqual([{ picture: null }])
  })
})
