<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import * as turf from '@turf/turf'
import { useUnits } from '@/composables/useUnits'
import { Card, CardContent } from '@/components/ui/card'
import type { RouteEdgeSegment, TravelMode } from '@/types/directions.types'
import {
  type RouteProfileType,
  PROFILE_TABS,
  CATEGORY_MAPS,
  getEdgeCategory,
} from '@/lib/route-profile-colors'

interface Props {
  geometry: Array<{ lat: number; lng: number; elevation?: number }>
  totalElevationGain?: number
  totalElevationLoss?: number
  maxElevation?: number
  minElevation?: number
  edgeSegments?: RouteEdgeSegment[]
  /** Travel mode — controls which profile tabs are shown */
  mode?: TravelMode | string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:routeProfile', profile: RouteProfileType | null): void
}>()
const { formatDistance, formatElevation } = useUnits()

// ── Available tabs for the current mode ─────────────────────────────

const visibleTabs = computed(() => {
  const m = props.mode || 'driving'
  return PROFILE_TABS.filter(tab => tab.modes.includes(m as TravelMode))
})

// ── Toggle state ────────────────────────────────────────────────────

/** Pick the best default tab for the current mode */
function defaultProfileForMode(mode?: string): RouteProfileType {
  const available = visibleTabs.value.map(t => t.id)
  // Cycling → stress first; others → first available (road type)
  if (mode === 'cycling' && available.includes('stress')) return 'stress'
  return available[0] || 'types'
}

const activeProfile = ref<RouteProfileType>(defaultProfileForMode(props.mode))

// When mode changes, reset to best default if current tab isn't available
watch(() => props.mode, (mode) => {
  const available = visibleTabs.value.map(t => t.id)
  if (!available.includes(activeProfile.value)) {
    activeProfile.value = defaultProfileForMode(mode)
  }
})

// Emit profile changes to parent (for map coloring sync)
watch(activeProfile, (profile) => {
  emit('update:routeProfile', profile)
}, { immediate: true })

// ── Chart data ──────────────────────────────────────────────────────

interface ChartDataPoint {
  distance: number
  elevation: number
}

const chartData = computed<ChartDataPoint[]>(() => {
  if (!props.geometry || props.geometry.length === 0) return []

  let cumulativeDistance = 0
  const data: ChartDataPoint[] = []

  for (let i = 0; i < props.geometry.length; i++) {
    const point = props.geometry[i]
    if (i > 0) {
      const prev = props.geometry[i - 1]
      cumulativeDistance += calculateDistance(prev.lat, prev.lng, point.lat, point.lng)
    }
    if (point.elevation !== undefined) {
      data.push({ distance: cumulativeDistance, elevation: point.elevation })
    }
  }
  return data
})

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const from = turf.point([lng1, lat1])
  const to = turf.point([lng2, lat2])
  return turf.distance(from, to, { units: 'meters' })
}

const hasElevationData = computed(() =>
  chartData.value.length > 0 && chartData.value.some(d => d.elevation !== undefined),
)

const hasEdgeData = computed(() =>
  props.edgeSegments != null && props.edgeSegments.length > 0,
)

const showChart = computed(() => hasElevationData.value || hasEdgeData.value)

const totalDistance = computed(() => {
  if (chartData.value.length === 0) return 0
  return chartData.value[chartData.value.length - 1].distance
})

// ── Coordinate mapping ──────────────────────────────────────────────

const CHART_HEIGHT = 120

const yDomain = computed(() => {
  if (chartData.value.length === 0) return [0, 100]
  const elevations = chartData.value.map(d => d.elevation).filter((e): e is number => e !== undefined)
  if (elevations.length === 0) return [0, 100]
  let min = Infinity
  let max = -Infinity
  for (const e of elevations) {
    if (e < min) min = e
    if (e > max) max = e
  }
  const range = max - min || 20
  return [min - range * 0.12, max + range * 0.12]
})

const chartContainerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(300)

let resizeObserver: ResizeObserver | null = null
let rafId: number | null = null

onMounted(() => {
  if (chartContainerRef.value) {
    containerWidth.value = chartContainerRef.value.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width
      }
    })
    resizeObserver.observe(chartContainerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (rafId !== null) cancelAnimationFrame(rafId)
})

function xScale(d: number): number {
  if (totalDistance.value === 0) return 0
  return (d / totalDistance.value) * containerWidth.value
}

function yScale(e: number): number {
  const [yMin, yMax] = yDomain.value
  const range = yMax - yMin
  if (range === 0) return CHART_HEIGHT / 2
  return CHART_HEIGHT - ((e - yMin) / range) * CHART_HEIGHT
}

// ── Colored paths ───────────────────────────────────────────────────

interface ColoredPath {
  d: string      // SVG line path
  fillD: string  // SVG area fill path
  color: string
}

function findEdgeIndex(distance: number): number {
  const segs = props.edgeSegments
  if (!segs || segs.length === 0) return -1
  let lo = 0, hi = segs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (distance < segs[mid].startDistance) hi = mid - 1
    else if (distance >= segs[mid].endDistance) lo = mid + 1
    else return mid
  }
  return -1
}

const PRIMARY_COLOR = 'hsl(var(--primary))'

function getEdgeColorByIndex(idx: number): string {
  if (!props.edgeSegments || idx < 0) return PRIMARY_COLOR
  const edge = props.edgeSegments[idx]
  const cat = getEdgeCategory(activeProfile.value, edge)
  if (cat.group === 'unknown') return PRIMARY_COLOR
  return cat.color
}

const coloredPaths = computed<ColoredPath[]>(() => {
  const data = chartData.value
  if (data.length < 2) return []

  // No edge data → single primary-color path
  if (!props.edgeSegments || props.edgeSegments.length === 0) {
    const lineParts = data.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${xScale(p.distance).toFixed(1)},${yScale(p.elevation).toFixed(1)}`,
    ).join(' ')
    const firstX = xScale(data[0].distance).toFixed(1)
    const lastX = xScale(data[data.length - 1].distance).toFixed(1)
    return [{
      d: lineParts,
      fillD: `${lineParts} L${lastX},${CHART_HEIGHT} L${firstX},${CHART_HEIGHT} Z`,
      color: 'hsl(var(--primary))',
    }]
  }

  // Group consecutive points by their edge segment index
  interface PointGroup { edgeIdx: number; points: ChartDataPoint[] }
  const groups: PointGroup[] = []

  for (const point of data) {
    const edgeIdx = findEdgeIndex(point.distance)
    const last = groups[groups.length - 1]

    if (last && last.edgeIdx === edgeIdx) {
      last.points.push(point)
    } else {
      // Overlap last point of previous group for line continuity
      const overlap = last?.points.length ? [last.points[last.points.length - 1]] : []
      groups.push({ edgeIdx, points: [...overlap, point] })
    }
  }

  return groups.filter(g => g.points.length >= 2).map(g => {
    const color = getEdgeColorByIndex(g.edgeIdx)
    const pts = g.points
    const lineParts = pts.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${xScale(p.distance).toFixed(1)},${yScale(p.elevation).toFixed(1)}`,
    ).join(' ')
    const firstX = xScale(pts[0].distance).toFixed(1)
    const lastX = xScale(pts[pts.length - 1].distance).toFixed(1)
    return {
      d: lineParts,
      fillD: `${lineParts} L${lastX},${CHART_HEIGHT} L${firstX},${CHART_HEIGHT} Z`,
      color,
    }
  })
})

// ── Custom hover ────────────────────────────────────────────────────

const mouseX = ref<number | null>(null)

interface HoveredProfileItem {
  label: string
  color: string
}

interface HoveredInfo {
  distance: number
  elevation: number
  /** One entry per visible profile tab (auto-generated) */
  profiles: HoveredProfileItem[]
}

const hoveredData = ref<HoveredInfo | null>(null)

/** Fixed-position coordinates for the teleported tooltip */
const tooltipPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })

function onMouseMove(e: MouseEvent) {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    _handleMouseMove(e)
  })
}

function _handleMouseMove(e: MouseEvent) {
  const el = chartContainerRef.value
  if (!el || chartData.value.length === 0) return
  const rect = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
  mouseX.value = x

  // Store page-level position for the teleported tooltip
  tooltipPos.value = { x: e.clientX, y: rect.top }

  const distance = (x / rect.width) * totalDistance.value

  // Binary search for nearest data point
  const data = chartData.value
  let lo = 0, hi = data.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (data[mid].distance < distance) lo = mid + 1
    else hi = mid
  }
  const a = data[lo]
  const b = data[Math.max(0, lo - 1)]
  const nearest = Math.abs(a.distance - distance) <= Math.abs(b.distance - distance) ? a : b

  // Build profile items for every visible tab automatically
  const profiles: HoveredProfileItem[] = []

  if (props.edgeSegments) {
    for (const seg of props.edgeSegments) {
      if (distance >= seg.startDistance && distance <= seg.endDistance) {
        for (const tab of visibleTabs.value) {
          const cat = getEdgeCategory(tab.id, seg)
          if (cat.group !== 'unknown') {
            profiles.push({ label: cat.label, color: cat.color })
          }
        }
        break
      }
    }
  }

  hoveredData.value = { distance, elevation: nearest.elevation, profiles }
}

function onMouseLeave() {
  mouseX.value = null
  hoveredData.value = null
}

const tooltipStyle = computed(() => {
  if (mouseX.value === null) return { display: 'none' }
  const vw = window.innerWidth
  const nearRight = tooltipPos.value.x > vw * 0.65
  return {
    position: 'fixed' as const,
    left: nearRight ? undefined : `${tooltipPos.value.x + 12}px`,
    right: nearRight ? `${vw - tooltipPos.value.x + 12}px` : undefined,
    // Anchor above the chart top edge
    bottom: `${window.innerHeight - tooltipPos.value.y + 8}px`,
    zIndex: 50,
    pointerEvents: 'none' as const,
  }
})

// ── Summary stats ───────────────────────────────────────────────────

interface StatItem { key: string; label: string; color: string; percentage: number }

function computeProfileStats(
  segments: RouteEdgeSegment[],
  profile: RouteProfileType,
): StatItem[] {
  const categoryMap = CATEGORY_MAPS[profile]
  if (!categoryMap) return []

  const groupTotals = new Map<string, { distance: number; label: string; color: string }>()
  let totalDist = 0

  for (const seg of segments) {
    const cat = getEdgeCategory(profile, seg)
    const dist = seg.endDistance - seg.startDistance
    totalDist += dist
    const existing = groupTotals.get(cat.group)
    if (existing) existing.distance += dist
    else groupTotals.set(cat.group, { distance: dist, label: cat.label, color: cat.color })
  }

  if (totalDist === 0) return []

  return Array.from(groupTotals.values())
    .map(g => ({
      key: g.label,
      label: g.label,
      color: g.color,
      percentage: Math.round((g.distance / totalDist) * 100),
    }))
    .filter(g => g.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage)
}

const activeStats = computed(() => {
  if (!props.edgeSegments) return []
  return computeProfileStats(props.edgeSegments, activeProfile.value)
})

function summarize(stats: StatItem[], mixedLabel: string): string {
  if (stats.length === 0) return ''
  const top = stats[0]
  if (top.percentage >= 90) return `${top.label}`
  if (top.percentage >= 65) return `Mostly ${top.label.toLowerCase()}`
  if (stats.length === 2 && stats[1].percentage >= 25) return `${top.label} & ${stats[1].label.toLowerCase()}`
  return mixedLabel
}

const MIXED_LABELS: Record<RouteProfileType, string> = {
  surface: 'Mixed surfaces',
  types: 'Mixed types',
  incline: 'Varied terrain',
  bike_network: 'Mixed networks',
  stress: 'Mixed stress',
  speed: 'Mixed speeds',
}

const activeSummary = computed(() =>
  summarize(activeStats.value, MIXED_LABELS[activeProfile.value] || 'Mixed'),
)
</script>

<template>
  <Card v-if="showChart" class="overflow-hidden">
    <CardContent class="p-0">
      <!-- Header: elevation stats -->
      <div
        v-if="hasElevationData || hasEdgeData"
        class="px-4 pt-2.5 pb-1"
      >
        <div class="flex items-center gap-4 text-sm">
          <div v-if="totalElevationGain" class="flex items-center gap-1.5">
            <span class="text-muted-foreground">&nearr;</span>
            <span class="font-medium">{{ formatElevation(totalElevationGain) }}</span>
          </div>
          <div v-if="totalElevationLoss" class="flex items-center gap-1.5">
            <span class="text-muted-foreground">&searr;</span>
            <span class="font-medium">{{ formatElevation(totalElevationLoss) }}</span>
          </div>
        </div>
      </div>

      <!-- Profile tabs (own row, scrollable) -->
      <div v-if="hasEdgeData && visibleTabs.length > 1" class="px-4 pb-2">
        <div class="flex items-center gap-0.5 bg-muted rounded-md p-0.5 w-fit max-w-full overflow-x-auto">
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            class="px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap"
            :class="activeProfile === tab.id
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'"
            @click="activeProfile = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Summary stats (above chart) -->
      <div v-if="hasEdgeData" class="px-4 pb-2 pt-0.5">
        <p class="text-xs font-medium text-foreground mb-1.5">{{ activeSummary }}</p>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          <div
            v-for="stat in activeStats"
            :key="stat.key"
            class="flex items-center gap-1.5"
          >
            <span
              class="shrink-0 w-1.5 h-1.5 rounded-full"
              :style="{ backgroundColor: stat.color }"
            />
            <span class="text-[11px] text-muted-foreground leading-none">
              {{ stat.percentage }}% {{ stat.label.toLowerCase() }}
            </span>
          </div>
        </div>
      </div>

      <!-- Chart area -->
      <div
        v-if="hasElevationData"
        ref="chartContainerRef"
        class="relative cursor-crosshair select-none"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
      >
        <!-- SVG chart -->
        <svg
          :width="containerWidth"
          :height="CHART_HEIGHT"
          class="w-full block"
          :viewBox="`0 0 ${containerWidth} ${CHART_HEIGHT}`"
          preserveAspectRatio="none"
        >
          <!-- Colored fill areas -->
          <path
            v-for="(seg, i) in coloredPaths"
            :key="'fill-' + i + '-' + activeProfile"
            :d="seg.fillD"
            :fill="seg.color"
            opacity="0.12"
          />
          <!-- Colored line segments -->
          <path
            v-for="(seg, i) in coloredPaths"
            :key="'line-' + i + '-' + activeProfile"
            :d="seg.d"
            :stroke="seg.color"
            stroke-width="2.5"
            fill="none"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <!-- Floating Y-axis label -->
        <div class="absolute left-2 top-2 z-20 pointer-events-none">
          <div
            v-if="maxElevation !== undefined"
            class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border"
          >
            {{ formatElevation(maxElevation) }}
          </div>
        </div>

        <!-- Floating X-axis labels -->
        <div class="absolute bottom-1.5 left-2 right-2 flex justify-between pointer-events-none z-20">
          <div class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border">
            0
          </div>
          <div
            v-if="totalDistance > 0"
            class="px-2 py-0.5 bg-background/90 backdrop-blur-sm rounded-full text-[10px] text-foreground font-medium shadow-sm border"
          >
            {{ formatDistance(totalDistance) }}
          </div>
        </div>

        <!-- Crosshair line -->
        <div
          v-if="mouseX !== null"
          class="absolute top-0 bottom-0 w-px bg-foreground/25 pointer-events-none z-10"
          :style="{ left: mouseX + 'px' }"
        />

      </div>

    </CardContent>
  </Card>

  <!-- Tooltip teleported to body so it's never clipped by parent overflow -->
  <Teleport to="body">
    <div
      v-if="hoveredData"
      :style="tooltipStyle"
    >
      <div class="bg-popover/95 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 text-xs space-y-1 min-w-[120px]">
        <div class="flex items-center justify-between gap-4">
          <span class="text-muted-foreground">{{ formatDistance(hoveredData.distance) }}</span>
          <span class="font-medium">{{ formatElevation(hoveredData.elevation) }}</span>
        </div>
        <div
          v-for="(item, i) in hoveredData.profiles"
          :key="i"
          class="flex items-center gap-1.5"
        >
          <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
          <span class="text-muted-foreground">{{ item.label }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
