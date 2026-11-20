import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { i18nPlugin } from '../lib/i18n/plugin'
import { removeAvatar, setAvatar } from '../services/avatar.service'

const MAX_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const app = new Elysia({ prefix: '/users' })

app.use(i18nPlugin).use(requireAuth).post(
  '/me/avatar',
  async ({ body: { file }, user, set, t }) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      set.status = 400
      return { message: t('errors.avatar.invalidType') }
    }

    if (file.size > MAX_SIZE) {
      set.status = 400
      return { message: t('errors.avatar.tooLarge') }
    }

    const picture = await setAvatar(user.id, new Uint8Array(await file.arrayBuffer()))
    return { picture }
  },
  {
    body: t.Object({
      file: t.File(),
    }),
    response: {
      200: t.Object({ picture: t.String({ description: 'Absolute URL of the new avatar' }) }),
      400: t.Object({ message: t.String() }),
    },
    detail: {
      tags: ['Users'],
      summary: 'Upload avatar',
      description:
        'Accepts a JPEG, PNG or WebP up to 2MB, center-crops it to a 256px square WebP and sets it as the caller’s picture. Each upload gets a new URL, so it can be cached indefinitely.',
    },
  },
)

app.use(requireAuth).delete(
  '/me/avatar',
  async ({ user, set }) => {
    await removeAvatar(user.id)
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
