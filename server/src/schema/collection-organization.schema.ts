import { pgTable, text, jsonb, integer } from 'drizzle-orm/pg-core'
import { users } from './users.schema'
import type {
  CollectionGroup,
  CollectionPlacement,
} from '../types/library.types'

export const collectionOrganizations = pgTable('collection_organizations', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  groups: jsonb('groups').$type<CollectionGroup[]>().notNull().default([]),
  placements: jsonb('placements')
    .$type<CollectionPlacement[]>()
    .notNull()
    .default([]),
  revision: integer('revision').notNull().default(0),
})
