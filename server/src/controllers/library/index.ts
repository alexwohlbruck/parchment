import { Elysia } from 'elysia'
import bookmarks from './bookmarks.controller'
import collections from './collections.controller'

const libraryController = new Elysia({ prefix: '/library' })
  .use(bookmarks)
  .use(collections)

export default libraryController
