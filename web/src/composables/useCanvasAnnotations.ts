/**
 * The canvas drawing tools.
 *
 * A tool is armed for as long as you keep drawing with it, the way it works
 * in Felt — pick Pin, drop as many pins as you like, press Escape when you're
 * done. Tools that know when they're finished (a pin, a rectangle's second
 * corner, a circle's edge) commit themselves; the open-ended ones (line,
 * polygon) collect until you press Done.
 *
 * While a tool is armed it takes the map's click event over entirely — the
 * same mechanism the measure tool uses — so clicking the map draws instead of
 * opening whatever is underneath.
 */

import { computed, onScopeDispose, ref } from 'vue'
import type { Position } from 'geojson'
import { mapEventBus } from '@/lib/eventBus'
import { useMapStore } from '@/stores/map.store'
import type { LngLat, MapEvents } from '@/types/map.types'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'
import {
  createAnnotation,
  isComplete,
  TOOL_AUTOCOMPLETES,
  TOOL_MINIMUM,
  DEFAULT_ANNOTATION_COLOR,
} from '@/lib/canvas-annotations'

export function useCanvasAnnotations(options: {
  /** Called with each finished annotation. */
  onCommit: (annotation: CanvasAnnotation) => void
}) {
  const mapStore = useMapStore()

  /**
   * Put the map into drawing mode, and take it back out again.
   *
   * Double-click zoom is the important half: two vertices placed close
   * together in quick succession read as a double-click, and the map zoomed
   * instead of taking the second point. The crosshair is the other half —
   * a map that behaves differently should look like it does.
   */
  function setDrawingMode(active: boolean) {
    const map = mapStore.getMapStrategy()?.mapInstance as
      | {
          doubleClickZoom?: { enable: () => void; disable: () => void }
          getCanvas?: () => HTMLCanvasElement
        }
      | undefined
    if (!map) return
    if (active) map.doubleClickZoom?.disable()
    else map.doubleClickZoom?.enable()
    const canvas = map.getCanvas?.()
    if (canvas) canvas.style.cursor = active ? 'crosshair' : ''
  }

  const tool = ref<AnnotationTool | null>(null)
  const color = ref(DEFAULT_ANNOTATION_COLOR)
  /** Positions clicked for the annotation currently being drawn. */
  const positions = ref<Position[]>([])

  const isArmed = computed(() => tool.value !== null)
  const canFinish = computed(
    () => !!tool.value && isComplete(tool.value, positions.value.length),
  )
  const canUndo = computed(() => positions.value.length > 0)

  /**
   * The in-progress annotation, for the editor to draw as a preview. Null
   * until it has enough positions to be worth showing.
   */
  const draft = computed<CanvasAnnotation | null>(() => {
    if (!tool.value || !positions.value.length) return null
    return {
      id: 'annotation-draft',
      tool: tool.value,
      positions: [...positions.value],
      color: color.value,
    }
  })

  function commit() {
    if (!tool.value || !canFinish.value) return
    options.onCommit(
      createAnnotation(tool.value, [...positions.value], color.value),
    )
    positions.value = []
  }

  function onMapClick(event: MapEvents['click']) {
    if (!tool.value) return
    const lngLat = event.lngLat as LngLat
    positions.value = [...positions.value, [lngLat.lng, lngLat.lat]]

    // Pins, rectangles and circles are finished the moment they have their
    // positions — there is nothing more to add, so committing keeps the tool
    // armed for the next one instead of asking for a press that means nothing.
    if (
      TOOL_AUTOCOMPLETES[tool.value] &&
      positions.value.length >= TOOL_MINIMUM[tool.value]
    ) {
      commit()
    }
  }

  function arm(next: AnnotationTool | null) {
    if (tool.value === next || !next) return disarm()
    positions.value = []
    if (!tool.value) mapEventBus.setOverride('click', onMapClick)
    tool.value = next
    setDrawingMode(true)
  }

  function disarm() {
    if (tool.value) mapEventBus.removeOverride('click', onMapClick)
    tool.value = null
    positions.value = []
    setDrawingMode(false)
  }

  /** Finish an open-ended shape and stay on the tool. */
  function finish() {
    commit()
  }

  function undo() {
    positions.value = positions.value.slice(0, -1)
  }

  onScopeDispose(disarm)

  return {
    tool,
    color,
    isArmed,
    canFinish,
    canUndo,
    draft,
    vertexCount: computed(() => positions.value.length),
    arm,
    disarm,
    finish,
    undo,
  }
}
