<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useMapStore } from '@/stores/map.store'
import { useLayersStore } from '@/stores/layers.store'
import { isImageryLayer, moveInStack } from '@/lib/imagery/imagery-stack'
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
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SatelliteIcon,
  XIcon,
} from 'lucide-vue-next'

const { t } = useI18n()
const router = useRouter()
const mapStore = useMapStore()
const { settings } = storeToRefs(mapStore)
const { layers } = storeToRefs(useLayersStore())

const imageryLayers = computed(() => layers.value.filter(isImageryLayer))
const stackIds = computed(() => settings.value.satelliteImagery ?? [])

const stack = computed(() =>
  stackIds.value.flatMap(id => imageryLayers.value.filter(l => l.id === id)),
)
const unused = computed(() =>
  imageryLayers.value.filter(l => !stackIds.value.includes(l.id)),
)

function move(id: string, step: -1 | 1) {
  mapStore.setSatelliteImagery(moveInStack(stackIds.value, id, step))
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

    <ol class="flex flex-col pl-8">
      <li
        v-for="(layer, index) in stack"
        :key="layer.id"
        class="flex items-center gap-2 h-9"
      >
        <span class="w-4 text-xs text-muted-foreground tabular-nums">{{ index + 1 }}</span>
        <span class="flex-1 truncate text-sm">{{ layer.name }}</span>
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :disabled="index === 0"
          :aria-label="t('settings.mapSettings.style.imagery.moveUp')"
          @click="move(layer.id, -1)"
        >
          <ChevronUpIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :disabled="index === stack.length - 1"
          :aria-label="t('settings.mapSettings.style.imagery.moveDown')"
          @click="move(layer.id, 1)"
        >
          <ChevronDownIcon class="size-4" />
        </Button>
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
      <li v-if="!stack.length" class="text-sm text-muted-foreground h-9 flex items-center">
        {{ t('settings.mapSettings.style.imagery.empty') }}
      </li>
    </ol>
  </div>
</template>
