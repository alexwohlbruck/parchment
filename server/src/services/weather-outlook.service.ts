import { integrationManager } from './integrations'
import { IntegrationCapabilityId, type WeatherOutlook } from '../types/integration.types'
import { logWarn } from '../lib/logger'

const TTL_MS = 20 * 60_000
const MAX_CELLS = 500
/** About 10 km: one forecast serves every route nearby. */
const CELL_DEGREES = 0.1

const cache = new Map<string, { outlook: WeatherOutlook | null; expires: number }>()

/** The next few hours' rain and low from the configured weather integration; null when none is set up or it fails. */
export async function getWeatherOutlook(lat: number, lng: number): Promise<WeatherOutlook | null> {
  const key = `${Math.round(lat / CELL_DEGREES)},${Math.round(lng / CELL_DEGREES)}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.outlook
  const [record] = integrationManager.getConfiguredIntegrationsByCapability(IntegrationCapabilityId.WEATHER)
  const weather = record && integrationManager.getCachedIntegrationInstance(record)?.capabilities.weather
  if (!weather?.getOutlook) return null
  let outlook: WeatherOutlook | null = null
  try {
    outlook = await weather.getOutlook(lat, lng)
  } catch (error) {
    logWarn(`Weather outlook unavailable: ${error instanceof Error ? error.message : error}`)
  }
  if (cache.size >= MAX_CELLS) cache.delete(cache.keys().next().value!)
  cache.set(key, { outlook, expires: Date.now() + TTL_MS })
  return outlook
}
