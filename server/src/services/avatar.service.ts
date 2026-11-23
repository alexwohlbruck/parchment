import sharp from 'sharp'
import { resolve } from 'path'
import { unlink } from 'fs/promises'
import { eq, like } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { storage as storageConfig } from '../config/storage.config'
import { blobStore, keyFromUrl, publicUrl } from './storage/storage.service'
import { updateUserDisplayProfile } from './user.service'
import { logger } from '../lib/logger'

export const AVATAR_SIZE = 256
const MAX_INPUT_PIXELS = 50_000_000
const DECODABLE_FORMATS = new Set(['jpeg', 'png', 'webp'])

export class UnreadableImageError extends Error {
  constructor() {
    super('Unreadable or unsupported image')
    this.name = 'UnreadableImageError'
  }
}

function avatarPrefix(userId: string) {
  return `avatars/${userId}/`
}

/** The user's stored avatar key, if their picture is one we host. */
function ownAvatarKey(userId: string, picture: string | null | undefined) {
  const key = keyFromUrl(picture)
  return key?.startsWith(avatarPrefix(userId)) ? key : null
}

async function currentPicture(userId: string) {
  const [row] = await db
    .select({ picture: users.picture })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.picture ?? null
}

async function storeAvatar(userId: string, webp: Uint8Array) {
  const hash = new Bun.CryptoHasher('sha256').update(webp).digest('hex').slice(0, 16)
  const key = `${avatarPrefix(userId)}${hash}.webp`
  await blobStore.put(key, webp, 'image/webp')
  return key
}

async function toAvatarWebp(image: Uint8Array) {
  const input = sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
  try {
    const { format } = await input.metadata()
    if (!format || !DECODABLE_FORMATS.has(format)) throw new UnreadableImageError()
    return await input
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer()
  } catch (error) {
    throw error instanceof UnreadableImageError ? error : new UnreadableImageError()
  }
}

/** Normalizes a JPEG, PNG or WebP to a square webp and makes it the user's picture. */
export async function setAvatar(userId: string, image: Uint8Array) {
  const webp = await toAvatarWebp(image)

  const previousKey = ownAvatarKey(userId, await currentPicture(userId))
  const key = await storeAvatar(userId, webp)
  const picture = publicUrl(key)

  await updateUserDisplayProfile(userId, { picture })
  if (previousKey && previousKey !== key) await blobStore.delete(previousKey)

  return picture
}

export async function removeAvatar(userId: string) {
  const previousKey = ownAvatarKey(userId, await currentPicture(userId))
  await updateUserDisplayProfile(userId, { picture: null })
  if (previousKey) await blobStore.delete(previousKey)
}

const LEGACY_PICTURE = /^\/users\/([^/]+)\/avatar$/

/** Moves avatars saved under the old `/users/:id/avatar` scheme into the blob store. */
export async function migrateLegacyAvatars() {
  const rows = await db
    .select({ id: users.id, picture: users.picture })
    .from(users)
    .where(like(users.picture, '/users/%/avatar'))

  for (const { id, picture } of rows) {
    if (picture?.match(LEGACY_PICTURE)?.[1] !== id) continue

    const legacyPath = resolve(storageConfig.localDir, 'avatars', `${id}.webp`)
    const file = Bun.file(legacyPath)
    if (!(await file.exists())) {
      await db.update(users).set({ picture: null }).where(eq(users.id, id))
      continue
    }

    const key = await storeAvatar(id, new Uint8Array(await file.arrayBuffer()))
    await db.update(users).set({ picture: publicUrl(key) }).where(eq(users.id, id))
    await unlink(legacyPath)
  }

  if (rows.length > 0) logger.info({ count: rows.length }, 'Migrated legacy avatars')
}
