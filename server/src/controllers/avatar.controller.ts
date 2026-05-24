import Elysia, { t } from 'elysia'
import { readFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { requireAuth } from '../middleware/auth.middleware'

const AVATARS_DIR = resolve(__dirname, '../../data/uploads/avatars')
const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const AVATAR_SIZE = 256
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function ensureAvatarsDir() {
  if (!existsSync(AVATARS_DIR)) {
    await mkdir(AVATARS_DIR, { recursive: true })
  }
}

function avatarPath(userId: string) {
  return resolve(AVATARS_DIR, `${userId}.webp`)
}

const app = new Elysia({ prefix: '/users' })

app.get(
  '/:id/avatar',
  async ({ params: { id }, set }) => {
    const filePath = avatarPath(id)
    if (!existsSync(filePath)) {
      set.status = 404
      return
    }

    const buffer = await readFile(filePath)
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=3600, must-revalidate',
      },
    })
  },
  {
    params: t.Object({ id: t.String() }),
    detail: {
      tags: ['Users'],
      summary: 'Get user avatar',
    },
  },
)

app.use(requireAuth).post(
  '/me/avatar',
  async ({ body: { file }, user, set }) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      set.status = 400
      return { message: 'File must be JPEG, PNG, or WebP' }
    }

    if (file.size > MAX_SIZE) {
      set.status = 400
      return { message: 'File must be under 2MB' }
    }

    await ensureAvatarsDir()

    const buffer = Buffer.from(await file.arrayBuffer())
    await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(avatarPath(user.id))

    const pictureUrl = `/users/${user.id}/avatar`
    await db
      .update(users)
      .set({ picture: pictureUrl, updatedAt: new Date() })
      .where(eq(users.id, user.id))

    return { picture: pictureUrl }
  },
  {
    body: t.Object({
      file: t.File(),
    }),
    detail: {
      tags: ['Users'],
      summary: 'Upload avatar',
    },
  },
)

app.use(requireAuth).delete(
  '/me/avatar',
  async ({ user, set }) => {
    const filePath = avatarPath(user.id)
    if (existsSync(filePath)) {
      await unlink(filePath)
    }

    await db
      .update(users)
      .set({ picture: null, updatedAt: new Date() })
      .where(eq(users.id, user.id))

    set.status = 204
  },
  {
    detail: {
      tags: ['Users'],
      summary: 'Delete avatar',
    },
  },
)

export default app
