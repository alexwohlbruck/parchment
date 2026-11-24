<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { availableImagery } from '@/lib/imagery/imagery-stack'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { AppRoute } from '@/router'
import { SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GripVerticalIcon, PlusIcon, SatelliteIcon, XIcon } from 'lucide-vue-next'
import type { Layer } from '@/types/map.types'

const { t } = useI18n()
const router = useRouter()
const mapStore = useMapStore()
const { settings } = storeToRefs(mapStore)
const { layers } = storeToRefs(useLayersStore())
const authService = useAuthService()

const imageryLayers = computed(() =>
  availableImagery(layers.value, authService.hasPermission(PermissionId.PREMIUM_PHOTOREALISTIC_3D)),
)
const stackIds = computed(() => settings.value.satelliteImagery ?? [])

const stack = computed(() =>
  stackIds.value.flatMap(id => imageryLayers.value.filter(l => l.id === id)),
)
const unused = computed(() =>
  imageryLayers.value.filter(l => !stackIds.value.includes(l.id)),
)

function reorder(layers: Layer[]) {
  mapStore.setSatelliteImagery(layers.map(l => l.id))
}

function remove(id: string) {
  mapStore.setSatelliteImagery(stackIds.value.filter(i => i !== id))
}

function add(id: string) {
  mapStore.setSatelliteImagery([...stackIds.value, id])
}

function createSource() {
  router.push({ name: AppRoute.LAYER_EDITOR_NEW, query: { imagery: '1' } })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <SettingsItem
      :title="t('settings.mapSettings.style.imagery.title')"
      :description="t('settings.mapSettings.style.imagery.description')"
      :icon="SatelliteIcon"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm">
            <PlusIcon class="size-3.5" />
            {{ t('settings.mapSettings.style.imagery.add') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            v-for="layer in unused"
            :key="layer.id"
            @select="add(layer.id)"
          >
            {{ layer.name }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="unused.length" />
          <DropdownMenuItem @select="createSource">
            {{ t('settings.mapSettings.style.imagery.create') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsItem>

    <draggable
      :model-value="stack"
      item-key="id"
      tag="ol"
      handle=".imagery-handle"
      :animation="150"
      class="flex flex-col pl-8"
      @update:model-value="reorder"
    >
      <template #item="{ element: layer, index }">
        <li class="flex items-center gap-2 h-9">
          <GripVerticalIcon class="size-3.5 shrink-0 text-muted-foreground/60 cursor-grab imagery-handle" />
          <span class="w-4 text-xs text-muted-foreground tabular-nums">{{ index + 1 }}</span>
          <span class="flex-1 truncate text-sm">{{ layer.name }}</span>
          <Button
            variant="ghost"
            size="icon"
            class="size-7"
            :aria-label="t('settings.mapSettings.style.imagery.remove')"
            @click="remove(layer.id)"
          >
            <XIcon class="size-4" />
          </Button>
        </li>
      </template>
      <template #footer>
        <li v-if="!stack.length" class="text-sm text-muted-foreground h-9 flex items-center">
          {{ t('settings.mapSettings.style.imagery.empty') }}
        </li>
      </template>
    </draggable>
  </div>
</template>
