import { docs } from 'collections/index'
import { loader } from 'fumadocs-core/source'

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})
