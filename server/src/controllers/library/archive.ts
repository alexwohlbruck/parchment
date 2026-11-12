import { Elysia, t } from 'elysia'
import { permissions } from '../../middleware/auth.middleware.js'
import { PermissionId } from '../../types/auth.types'
import { i18nPlugin } from '../../lib/i18n/plugin'
import type { TranslateFn, TranslationKey } from '../../lib/i18n/i18n.types'

/** `PUT` and `DELETE /:id/archive` for a library resource. */
export function archiveEndpoints(params: {
  noun: string
  description: string
  notFound: TranslationKey
  setArchived: (id: string, userId: string, archived: boolean) => Promise<unknown>
}) {
  const { noun, description, notFound, setArchived } = params

  async function handle(
    id: string,
    userId: string,
    archived: boolean,
    set: { status?: number | string },
    translate: TranslateFn,
  ) {
    const result = await setArchived(id, userId, archived)
    if (!result) {
      set.status = 404
      return { error: translate(notFound) }
    }
    return result
  }

  return new Elysia()
    .use(i18nPlugin)
    .use(permissions(PermissionId.LIBRARY_WRITE))
    .put(
      '/:id/archive',
      ({ params: { id }, user, set, t }) => handle(id, user.id, true, set, t),
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Library'], summary: `Archive a ${noun}`, description },
      },
    )
    .delete(
      '/:id/archive',
      ({ params: { id }, user, set, t }) => handle(id, user.id, false, set, t),
      {
        params: t.Object({ id: t.String() }),
        detail: { tags: ['Library'], summary: `Unarchive a ${noun}` },
      },
    )
}
