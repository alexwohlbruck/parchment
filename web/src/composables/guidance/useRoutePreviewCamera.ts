import { useMapService } from '@/services/map/map.service'
import { segmentAt, smoothedBearingAt, type NavRoute, type NavStep } from '@/lib/guidance/nav-route'
import { drawnLine, drawnPoint } from '@/lib/guidance/route-line'
import { modeProfile } from '@/lib/guidance/mode-profiles'

const FLY_MS = 900
const STEP_PITCH = 50
/** Looks along the approach, so the turn sits ahead of the camera. */
const APPROACH_METERS = 25

/** Frames a previewed leg: the whole of it, or one maneuver seen on approach. */
export function useRoutePreviewCamera() {
  const mapService = useMapService()

  function overview(route: NavRoute) {
    if (route.points.length < 2) return
    const lngs = route.points.map(p => p.lng)
    const lats = route.points.map(p => p.lat)
    mapService.fitBounds(
      { minLng: Math.min(...lngs), minLat: Math.min(...lats), maxLng: Math.max(...lngs), maxLat: Math.max(...lats) },
      { bearing: 0, pitch: 0, duration: FLY_MS },
    )
  }

  function focus(route: NavRoute, step: NavStep) {
    const s = step.startDistance
    const at = drawnPoint(route, s)
    const camera = modeProfile(segmentAt(route, s)?.mode ?? 'driving').camera
    mapService.flyTo({
      center: [at.lng, at.lat],
      zoom: camera.maxZoom - 0.5,
      pitch: STEP_PITCH * camera.pitchScale,
      bearing: smoothedBearingAt(drawnLine(route), Math.max(0, s - APPROACH_METERS), APPROACH_METERS),
      duration: FLY_MS,
    })
  }

  return { overview, focus }
}
