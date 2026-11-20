import Elysia from 'elysia'
import { blobStore, isPublicKey } from '../services/storage/storage.service'

const app = new Elysia({ prefix: '/files' })

app.get(
  '/*',
  async ({ params, set }) => {
    const key = params['*']
    const blob = isPublicKey(key) ? await blobStore.get(key) : null
    if (!blob) {
      set.status = 404
      return
    }

    return new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  },
  {
    detail: {
      tags: ['Files'],
      summary: 'Get a public file',
      description:
        'Serves uploaded public files such as avatars when no STORAGE_PUBLIC_URL is configured. Keys are content-addressed, so responses are immutable.',
    },
  },
)

export default app
