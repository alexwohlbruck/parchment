<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  FootprintsIcon,
  BikeIcon,
  CarFrontIcon,
  ArrowLeftRightIcon,
  RepeatIcon,
  Undo2Icon,
  Redo2Icon,
  RouteIcon,
  Trash2Icon,
  CornerUpLeftIcon,
  XIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  ClockIcon,
  Loader2Icon,
} from 'lucide-vue-next'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import ElevationChart from '@/components/directions/ElevationChart.vue'
import { useRouteBuilderStore } from '@/stores/route-builder.store'
import { useRouteBuilderService } from '@/services/route-builder.service'
import { useRoutesService } from '@/services/library/routes.service'
import { useMapListener } from '@/composables/useMapListener'
import { useUnits } from '@/composables/useUnits'
import { AppRoute } from '@/router'
import type { RouteMode } from '@/types/routes.types'

const props = defineProps<{ id?: string }>()

const router = useRouter()
const store = useRouteBuilderStore()
const builder = useRouteBuilderService()
const routesService = useRoutesService()
const { formatDistance, formatElevation } = useUnits()

const {
  mode,
  waypoints,
  stats,
  geometry,
  elevation,
  isRouting,
  routeError,
  canUndo,
  canRedo,
  canRoute,
  hasWaypoints,
  isClosedLoop,
} = storeToRefs(store)

const modes: { id: RouteMode; label: string; icon: any }[] = [
  { id: 'walking', label: 'Walking', icon: FootprintsIcon },
  { id: 'cycling', label: 'Cycling', icon: BikeIcon },
  { id: 'driving', label: 'Driving', icon: CarFrontIcon },
]

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h} hr ${rem} min` : `${h} hr`
}

// Build the {lng,lat,elevation} array the ElevationChart expects.
const chartGeometry = computed(() =>
  geometry.value.map(([lng, lat], i) => ({
    lng,
    lat,
    elevation: elevation.value[i],
  })),
)
const hasElevation = computed(() => elevation.value.length > 0)

// ── Map click → add waypoint ───────────────────────────────────────────────
useMapListener(
  'click',
  (e) => builder.addWaypointAt(e.lngLat),
  { override: true },
)

// ── Keyboard undo/redo ──────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  if (!meta || e.key.toLowerCase() !== 'z') return
  // Ignore while typing in the save dialog.
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  if (e.shiftKey) store.redo()
  else store.undo()
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(async () => {
  if (props.id) {
    // Edit an existing saved route.
    const route =
      routesService && (await routesService.fetchRouteById(props.id))
    if (route?.body) {
      store.startEditing({
        routeId: route.id,
        mode: route.mode,
        scheme: route.scheme,
        waypoints: route.body.waypoints ?? [],
        geometry: route.body.geometry ?? [],
        elevation: route.body.elevation,
        segments: route.body.segments,
        stats: route.body.stats ?? null,
      })
    } else {
      store.start()
    }
  } else {
    store.start()
  }
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

// Reset clears the map line/markers when leaving the builder. We snapshot
// whether we're handing off to directions first so the directions store keeps
// its waypoints.
onBeforeRouteLeave(() => {
  store.reset()
})

// ── Actions ──────────────────────────────────────────────────────────────────
function close() {
  router.push({ name: AppRoute.LIBRARY_ROUTES })
}

function goToDirections() {
  if (builder.toDirections()) {
    router.push({ name: AppRoute.DIRECTIONS })
  }
}

// ── Save dialog ───────────────────────────────────────────────────────────────
const saveOpen = ref(false)
const saveName = ref('')
const saveDescription = ref('')
const savePrivate = ref(false)
const saving = ref(false)

function openSave() {
  saveName.value =
    store.waypoints[0]?.name || store.waypoints.at(-1)?.name || ''
  saveOpen.value = true
}

async function confirmSave() {
  if (!saveName.value.trim()) return
  saving.value = true
  const result = await builder.save({
    name: saveName.value.trim(),
    description: saveDescription.value.trim() || undefined,
    icon: 'Route',
    iconColor: 'cobalt',
    scheme: savePrivate.value ? 'user-e2ee' : 'server-key',
  })
  saving.value = false
  if (result) {
    saveOpen.value = false
    router.push({ name: AppRoute.ROUTE_DETAIL, params: { id: result.id } })
  }
}
</script>

<template>
  <PanelLayout>
    <div class="flex items-center justify-between mb-3">
      <h1 class="text-xl font-semibold">
        {{ store.editingRouteId ? 'Edit route' : 'Create a route' }}
      </h1>
      <Button variant="ghost" size="icon" @click="close">
        <XIcon class="size-4" />
      </Button>
    </div>

    <!-- Mode picker (same component as the Directions view) -->
    <Tabs
      :model-value="mode"
      class="mb-3"
      @update:model-value="(v) => v && store.setMode(v as RouteMode)"
    >
      <TabsList class="w-full flex">
        <TabsTrigger
          v-for="m in modes"
          :key="m.id"
          :value="m.id"
          class="grow"
          :title="m.label"
        >
          <component :is="m.icon" class="size-5" />
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <!-- Shaping actions -->
    <TooltipProvider>
    <div class="flex items-center gap-1 mb-3">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            :disabled="!canRoute"
            @click="store.reverse()"
          >
            <ArrowLeftRightIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reverse</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            :disabled="!canRoute || isClosedLoop"
            @click="store.outAndBack()"
          >
            <RepeatIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ isClosedLoop ? 'Already a loop' : 'Out & back' }}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            :disabled="!canRoute || isClosedLoop"
            @click="store.closeLoop()"
          >
            <RouteIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ isClosedLoop ? 'Already a loop' : 'Close loop' }}
        </TooltipContent>
      </Tooltip>

      <div class="w-px h-6 bg-border mx-1" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            :disabled="!canUndo"
            @click="store.undo()"
          >
            <Undo2Icon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="outline"
            size="icon"
            :disabled="!canRedo"
            @click="store.redo()"
          >
            <Redo2Icon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <div class="flex-1" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            :disabled="!hasWaypoints"
            @click="store.removeLastWaypoint()"
          >
            <CornerUpLeftIcon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remove last point</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            :disabled="!hasWaypoints"
            @click="store.clearWaypoints()"
          >
            <Trash2Icon class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Clear all</TooltipContent>
      </Tooltip>
    </div>
    </TooltipProvider>

    <!-- Stats card -->
    <div class="rounded-lg border p-3 mb-3">
      <div v-if="!canRoute" class="text-sm text-muted-foreground text-center py-3">
        Tap the map to drop points. The route snaps to {{ mode }} paths between
        them.
      </div>
      <template v-else>
        <div class="flex items-baseline gap-3 flex-wrap">
          <span class="text-2xl font-semibold">
            {{ stats ? formatDistance(stats.distance) : '—' }}
          </span>
          <span
            v-if="stats"
            class="inline-flex items-center gap-1 text-sm text-muted-foreground"
          >
            <ClockIcon class="size-3.5" />
            {{ formatDuration(stats.duration) }}
          </span>
          <span
            v-if="stats?.elevationGain"
            class="inline-flex items-center gap-0.5 text-sm text-muted-foreground"
          >
            <ArrowUpRightIcon class="size-3.5" />
            {{ formatElevation(stats.elevationGain) }}
          </span>
          <span
            v-if="stats?.elevationLoss"
            class="inline-flex items-center gap-0.5 text-sm text-muted-foreground"
          >
            <ArrowDownRightIcon class="size-3.5" />
            {{ formatElevation(stats.elevationLoss) }}
          </span>
          <Loader2Icon
            v-if="isRouting"
            class="size-4 animate-spin text-muted-foreground"
          />
        </div>
        <p v-if="routeError" class="text-sm text-destructive mt-1">
          {{ routeError }}
        </p>

        <div v-if="hasElevation" class="mt-3">
          <ElevationChart
            :segment-index="0"
            :geometry="chartGeometry"
            :mode="mode"
            :total-elevation-gain="stats?.elevationGain"
            :total-elevation-loss="stats?.elevationLoss"
          />
        </div>
      </template>
    </div>

    <!-- Primary actions -->
    <div class="flex gap-2">
      <Button
        variant="outline"
        class="flex-1"
        :disabled="!canRoute"
        @click="goToDirections"
      >
        Directions
      </Button>
      <Button class="flex-1" :disabled="!canRoute" @click="openSave">
        {{ store.editingRouteId ? 'Save changes' : 'Save route' }}
      </Button>
    </div>

    <!-- Save dialog -->
    <Dialog v-model:open="saveOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {{ store.editingRouteId ? 'Save changes' : 'Save route' }}
          </DialogTitle>
          <DialogDescription>
            Give your route a name so you can find it later.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <Input
            v-model="saveName"
            placeholder="Route name"
            autofocus
            @keydown.enter="confirmSave"
          />
          <Textarea
            v-model="saveDescription"
            placeholder="Description (optional)"
            rows="3"
          />
          <label
            v-if="!store.editingRouteId"
            class="flex items-center justify-between gap-3 rounded-md border p-2.5"
          >
            <span class="text-sm">
              <span class="font-medium">Private route</span>
              <span class="block text-xs text-muted-foreground">
                End-to-end encrypted. Can't be shared by link.
              </span>
            </span>
            <Switch
              :model-value="savePrivate"
              @update:model-value="(v) => (savePrivate = v)"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" @click="saveOpen = false">Cancel</Button>
          <Button :disabled="!saveName.trim() || saving" @click="confirmSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </PanelLayout>
</template>
