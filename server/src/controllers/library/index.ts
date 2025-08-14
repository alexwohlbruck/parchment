import { Elysia } from 'elysia'
import bookmarks from './bookmarks.controller'
import collections from './collections.controller'
import layers from './layers.controller'

const app = new Elysia({ prefix: '/library' })
  .use(bookmarks)
  .use(collections)
  .use(layers)

export default app
