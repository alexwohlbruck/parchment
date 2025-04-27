import { Elysia } from 'elysia'
import savedPlaces from './saved-places.controller'
import collections from './collections.controller'

const libraryController = new Elysia({ prefix: '/library' })
  .use(savedPlaces)
  .use(collections)

export default libraryController
