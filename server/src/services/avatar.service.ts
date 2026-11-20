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

/** Normalizes any decodable image to a square webp and makes it the user's picture. */
export async function setAvatar(userId: string, image: Uint8Array) {
  const webp = await sharp(image)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .webp({ quality: 85 })
    .toBuffer()

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
