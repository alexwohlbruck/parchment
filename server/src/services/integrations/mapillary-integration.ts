import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
} from '../../types/integration.types'
import type { StreetImageryPreview } from '../../types/place.types'

export interface MapillaryConfig extends IntegrationConfig {
  accessToken: string
}

/** Mapillary image radius search caps the radius at 50 m. */
const MAX_RADIUS_METERS = 50

/**
 * Great-circle distance in metres between two coordinates.
 */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export class MapillaryIntegration implements Integration<MapillaryConfig> {
  private initialized = false

  readonly integrationId = IntegrationId.MAPILLARY
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.MAP_LAYER,
    IntegrationCapabilityId.STREET_VIEW,
  ]
  readonly capabilities = {}

  protected config: MapillaryConfig = {
    accessToken: '',
  }

  initialize(config: MapillaryConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: Access token is required')
    }

    this.config = {
      accessToken: config.accessToken,
    }

    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(
    config: MapillaryConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: Access token is required',
      }
    }

    try {
      // TODO:
      // Attempt a lightweight request against Mapillary API using the token
      // const testUrl =
      //   'https://graph.mapillary.com/image?fields=id&limit=1&access_token=' +
      //   encodeURIComponent(config.accessToken)
      // const response = await fetch(testUrl)

      // if (!response.ok) {
      //   return {
      //     success: false,
      //     message: 'Invalid access token or API error',
      //   }
      // }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to connect to Mapillary API',
      }
    }
  }

  validateConfig(config: MapillaryConfig): boolean {
    return Boolean(config && config.accessToken)
  }

  /**
   * Find the nearest street-level image to a coordinate using Mapillary's
   * image radius search. Mapillary ranks results by proximity, recency and
   * panoramic preference, so the first result is the best preview candidate.
   *
   * @returns the nearest image, or null if none exist within the radius.
   */
  async findNearestImage(
    lat: number,
    lng: number,
    radius = MAX_RADIUS_METERS,
  ): Promise<StreetImageryPreview | null> {
    if (!this.config.accessToken) return null

    const params = new URLSearchParams({
      access_token: this.config.accessToken,
      fields: 'id,geometry,captured_at,compass_angle,is_pano,thumb_1024_url',
      lat: String(lat),
      lng: String(lng),
      radius: String(Math.min(radius, MAX_RADIUS_METERS)),
      limit: '1',
    })

    const response = await fetch(
      `https://graph.mapillary.com/images?${params}`,
      { signal: AbortSignal.timeout(8_000) },
    )

    if (!response.ok) {
      throw new Error(`Mapillary image search failed: ${response.status}`)
    }

    const body = (await response.json()) as {
      data?: Array<{
        id: string
        geometry?: { coordinates?: [number, number] }
        captured_at?: number
        compass_angle?: number
        is_pano?: boolean
        thumb_1024_url?: string
      }>
    }

    const image = body.data?.[0]
    if (!image || !image.thumb_1024_url) return null

    const [imgLng, imgLat] = image.geometry?.coordinates ?? [lng, lat]

    return {
      imageId: image.id,
      thumbUrl: image.thumb_1024_url,
      isPano: Boolean(image.is_pano),
      capturedAt: image.captured_at,
      compassAngle: image.compass_angle,
      lat: imgLat,
      lng: imgLng,
      distanceMeters: Math.round(haversineMeters(lat, lng, imgLat, imgLng)),
    }
  }
}
