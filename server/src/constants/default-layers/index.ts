import { DefaultLayerTemplate, DefaultLayerGroupTemplate } from '../../types/layers.types'
import { DEFAULT_LAYER_GROUPS } from './groups'
import { FRIENDS_LAYER_TEMPLATES } from './friends'
import { CYCLING_LAYER_TEMPLATES } from './cycling'
import { MAPILLARY_LAYER_TEMPLATES } from './mapillary'
import { TRANSIT_LAYER_TEMPLATES } from './transit'
import { USER_LAYER_TEMPLATES } from './user-templates'

export const DEFAULT_GROUP_TEMPLATES: DefaultLayerGroupTemplate[] = DEFAULT_LAYER_GROUPS

export const DEFAULT_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  ...FRIENDS_LAYER_TEMPLATES,
  ...CYCLING_LAYER_TEMPLATES,
  ...MAPILLARY_LAYER_TEMPLATES,
  ...TRANSIT_LAYER_TEMPLATES,
  ...USER_LAYER_TEMPLATES,
]

export function getProxyUrl(serverUrl: string, endpoint: string): string {
  const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  return `${base}/proxy/${endpoint}`
}

// Resolve {PROXY_URL} placeholders in layer configuration tile URLs
export function resolveProxyUrls(configuration: any, serverUrl: string): any {
  const config = JSON.parse(JSON.stringify(configuration))
  const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl
  const proxyBase = `${base}/proxy`

  function replacePlaceholders(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/\{PROXY_URL\}/g, proxyBase)
    }
    if (Array.isArray(obj)) {
      return obj.map(replacePlaceholders)
    }
    if (obj && typeof obj === 'object') {
      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = replacePlaceholders(value)
      }
      return result
    }
    return obj
  }

  return replacePlaceholders(config)
}

export { DEFAULT_LAYER_GROUPS }
