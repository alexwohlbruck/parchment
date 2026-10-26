import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { calculateFitPadding, toContainerRect } from '@/lib/map/map-padding'
import { segmentAt, smoothedBearingAt, type NavRoute, type NavStep } from '@/lib/guidance/nav-route'
import { drawnLine, drawnPoint } from '@/lib/guidance/route-line'
import { modeProfile } from '@/lib/guidance/mode-profiles'

const FLY_MS = 900
const STEP_PITCH = 50
/** Looks along the approach, so the turn sits ahead of the camera. */
const APPROACH_METERS = 25

/** Frames a previewed leg: the whole of it, or one maneuver seen on approach. */
export function useRoutePreviewCamera() {
  const appStore = useAppStore()
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined

  function visibleRect() {
    if (!map) return null
    return toContainerRect(appStore.visibleMapArea, map.getContainer().getBoundingClientRect())
  }

  function overview(route: NavRoute) {
    const visible = visibleRect()
    if (!map || !visible || route.points.length < 2) return
    const lngs = route.points.map(p => p.lng)
    const lats = route.points.map(p => p.lat)
    const container = map.getContainer()
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      {
        padding: calculateFitPadding(visible, container.clientWidth, container.clientHeight),
        bearing: 0,
        pitch: 0,
        duration: FLY_MS,
      },
    )
  }

  function focus(route: NavRoute, step: NavStep) {
    const visible = visibleRect()
    if (!map || !visible) return
    const s = step.startDistance
    const line = drawnLine(route)
    const at = drawnPoint(route, s)
    const camera = modeProfile(segmentAt(route, s)?.mode ?? 'driving').camera
    const container = map.getContainer()
    map.flyTo({
      center: [at.lng, at.lat],
      zoom: camera.maxZoom - 0.5,
      pitch: STEP_PITCH * camera.pitchScale,
      bearing: smoothedBearingAt(line, Math.max(0, s - APPROACH_METERS), APPROACH_METERS),
      offset: [
        visible.x + visible.width / 2 - container.clientWidth / 2,
        visible.y + visible.height / 2 - container.clientHeight / 2,
      ],
      duration: FLY_MS,
      essential: true,
    })
  }

  return { overview, focus }
}
