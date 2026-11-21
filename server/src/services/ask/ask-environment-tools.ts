import { bbox, booleanPointInPolygon, centroid, circle, distance, point } from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { getFireHotspots, getFirePerimeters, getSmokePlumes, isFirmsConfigured } from '../wildfire.service'
import { distanceText } from '../../lib/ask/distance-text'
import { cached, centre, clamp, pointSchema, type AskTool, type PointArg } from './ask-tool-base'

const DEFAULT_RADIUS_KM = 100
const MAX_RADIUS_KM = 400
const MAX_FIRES = 8

type Shape = Feature<Polygon | MultiPolygon>

const isShape = (feature: Feature): feature is Shape =>
  feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'

const wildfires: AskTool<{ near?: PointArg; radius_km?: number }> = {
  name: 'wildfires',
  description:
    'Active wildfires near a point: named fires with their size and containment (US), satellite fire detections from the last 2 days, and whether smoke is overhead. For "any fires near Tahoe", "is it smoky".',
  parameters: {
    type: 'object',
    properties: {
      near: pointSchema("Defaults to the map's centre."),
      radius_km: { type: 'number', description: `Default ${DEFAULT_RADIUS_KM}, max ${MAX_RADIUS_KM}` },
    },
  },
  label: () => 'Checking for wildfires',
  async run(args, context) {
    const at = await centre(args.near, context)
    const radius = clamp(args.radius_km, DEFAULT_RADIUS_KM, MAX_RADIUS_KM)
    const [west, south, east, north] = bbox(circle([at.lng, at.lat], radius, { steps: 16 }))
    const area = { west, south, east, north }
    const here = point([at.lng, at.lat])
    const key = { lat: at.lat.toFixed(2), lng: at.lng.toFixed(2), radius }
    const [perimeters, hotspots, smoke] = await cached('wildfires', key, { language: context.language }, () =>
      Promise.all([getFirePerimeters(area), getFireHotspots(area, 2), getSmokePlumes(area)]),
    )

    const km = (feature: Shape) =>
      booleanPointInPolygon(here, feature) ? 0 : distance(here, centroid(feature), { units: 'meters' })
    const fires = perimeters.features
      .filter(isShape)
      .map((feature) => ({ feature, meters: km(feature) }))
      .filter(({ meters }) => meters <= radius * 1000)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, MAX_FIRES)
      .map(({ feature, meters }) => {
        const p = feature.properties ?? {}
        return {
          name: p.attr_IncidentName ?? p.poly_IncidentName ?? 'Unnamed fire',
          distance: meters === 0 ? 'here' : distanceText(meters, context.units),
          ...(p.poly_GISAcres != null && { acres: Math.round(p.poly_GISAcres) }),
          ...(p.attr_PercentContained != null && { contained_percent: p.attr_PercentContained }),
          ...(p.attr_FireDiscoveryDateTime && {
            since: new Date(p.attr_FireDiscoveryDateTime).toISOString().slice(0, 10),
          }),
        }
      })

    const detections = hotspots.features
      .map((feature) => distance(here, feature.geometry.coordinates, { units: 'meters' }))
      .filter((meters) => meters <= radius * 1000)
    const overhead = smoke.features
      .filter(isShape)
      .filter((feature) => booleanPointInPolygon(here, feature))
      .map((feature) => String(feature.properties?.Density ?? ''))
    const densest = ['Heavy', 'Medium', 'Light'].find((level) => overhead.includes(level))

    return {
      within: distanceText(radius * 1000, context.units),
      named_fires: fires,
      ...(isFirmsConfigured() && {
        satellite_detections: detections.length,
        ...(detections.length && { nearest_detection: distanceText(Math.min(...detections), context.units) }),
      }),
      smoke_overhead: densest ?? (overhead.length ? 'yes' : 'none'),
      covers: 'Named fires are US only; smoke covers North America.',
    }
  },
}

export const environmentTools: AskTool[] = [wildfires]
