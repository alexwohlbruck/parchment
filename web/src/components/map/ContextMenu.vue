<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAppService } from '@/services/app.service'
import { useDirectionsService } from '@/services/directions.service'
import { mapEventBus } from '@/lib/eventBus'
import { LngLat } from '@/types/map.types'
import { useDirectionsStore } from '@/stores/directions.store'
import {
  PencilIcon,
  CopyIcon,
  ArrowDownToDot,
  ArrowUpFromDot,
  PlusIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const router = useRouter()
const appService = useAppService()
const directionsService = useDirectionsService()
const directionsStore = useDirectionsStore()
const { t } = useI18n()

const { waypoints } = storeToRefs(directionsStore)

const showContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const clickedLngLat = ref<LngLat | null>(null)

onMounted(() => {
  mapEventBus.on('contextmenu', e => {
    contextMenuPosition.value = { x: e.point.x, y: e.point.y - 18 }
    clickedLngLat.value = e.lngLat
    showContextMenu.value = true
  })
})

onUnmounted(() => {
  mapEventBus.off('contextmenu')
})

function copyCoordinates(lngLat: LngLat) {
  const coordString = `${lngLat.lat}, ${lngLat.lng}`
  navigator.clipboard.writeText(coordString)
  appService.toast.info(t('messages.coordinatesCopied'))
}

const useMultistopDirections = computed(() => {
  const filledWaypointsCount = waypoints.value.reduce(
    (count, waypoint) => (waypoint.lngLat ? count + 1 : count),
    0,
  )
  console.log(filledWaypointsCount, waypoints.value.length)
  return waypoints.value.length > 2 || filledWaypointsCount >= 2
})

function directionsTo() {
  router.push('/directions')
  directionsService.directionsTo({
    lngLat: clickedLngLat.value,
  })
}

function directionsFrom() {
  router.push('/directions')
  directionsService.directionsFrom({
    lngLat: clickedLngLat.value,
  })
}

function fillWaypoint() {
  router.push('/directions')
  setTimeout(() => {
    directionsService.fillWaypoint({
      lngLat: clickedLngLat.value,
    })
  }, 0)
}

function openMapEditor(editor: 'id' | 'josm' | 'potlatch') {
  if (!clickedLngLat.value) return
  switch (editor) {
    case 'id':
      window.open(
        `https://www.openstreetmap.org/edit?editor=id#map=19/${clickedLngLat.value.lat}/${clickedLngLat.value.lng}`,
        '_blank',
      )
      break
    case 'josm':
      // TODO:
      break
    case 'potlatch':
      // TODO:
      break
  }
}
</script>

<template>
  <DropdownMenu :open="showContextMenu" @update:open="showContextMenu = $event">
    <div
      :style="{
        position: 'fixed',
        left: `${contextMenuPosition.x}px`,
        top: `${contextMenuPosition.y}px`,
      }"
    >
      <DropdownMenuTrigger> </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent align="start" :side-offset="0">
      <DropdownMenuGroup>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsFrom()"
        >
          <ArrowUpFromDot class="size-4 rotate-90" />
          <span>{{ $t('directions.directionsFromHere') }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="!useMultistopDirections"
          @click="directionsTo()"
        >
          <ArrowDownToDot class="size-4 -rotate-90" />
          <span>{{ $t('directions.directionsToHere') }}</span>
        </DropdownMenuItem>
        <DropdownMenuItem v-if="useMultistopDirections" @click="fillWaypoint()">
          <PlusIcon class="size-4" />
          <span>{{ $t('directions.addStop') }}</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          @click="copyCoordinates(clickedLngLat)"
          v-if="clickedLngLat"
        >
          <CopyIcon />
          <span>
            {{ clickedLngLat.lat.toFixed(5) }},
            {{ clickedLngLat.lng.toFixed(5) }}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PencilIcon class="mr-2 size-4" />
            <span>{{ $t('map.contextMenu.edit') }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuItem @click="openMapEditor('id')">
                <span>OpenStreetMap iD</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled @click="openMapEditor('josm')">
                <span>JOSM</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled @click="openMapEditor('potlatch')">
                <span>Potlatch</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
