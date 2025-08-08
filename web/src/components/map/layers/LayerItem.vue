<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useLayersStore } from '@/stores/layers.store'
import { useLayersService } from '@/services/layers.service'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import type { Layer } from '@/types/map.types'
import * as LucideIcons from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreHorizontalIcon,
  PencilIcon,
  MoveIcon,
  TrashIcon,
} from 'lucide-vue-next'
import LayerConfiguration from './LayerConfiguration.vue'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'

interface Props {
  layer: Layer
  showUngroupAction?: boolean
  compact?: boolean
  groupId?: string
}

const props = withDefaults(defineProps<Props>(), {
  showUngroupAction: false,
  compact: false,
})

const emit = defineEmits<{
  ungroup: [layerId: string]
}>()

const { t } = useI18n()
const layersStore = useLayersStore()
const layersService = useLayersService()
const mapService = useMapService()
const appService = useAppService()

// Determine if this layer belongs to system defaults
const defaultConfigIds = new Set([
  'mapillary-overview',
  'mapillary-sequence',
  'mapillary-image',
  'transitland',
])

function isDefaultLayer(layer: Layer): boolean {
  const idIsReserved =
    typeof layer.id === 'string' && layer.id.startsWith('reserved:')
  const cfgId = (layer as any)?.configuration?.id as string | undefined
  const cfgIsDefault = !!cfgId && defaultConfigIds.has(cfgId)
  return idIsReserved || cfgIsDefault
}

// Helper function to convert icon string name to Vue component
function getIconComponent(iconName?: string | null) {
  if (!iconName) return null

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon ? LucideIcons[fullName as keyof typeof LucideIcons] : null
}

function openLayerConfigDialog() {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layerId: props.layer.id,
    },
  })
}

function handleUngroup() {
  const layerId = props.layer.id
  if (layerId) {
    emit('ungroup', layerId)
  }
}

async function deleteLayer() {
  const confirmed = await appService.confirm({
    title: t('layers.actions.deleteLayer'),
    description: t('library.confirmDelete', { name: props.layer.name }),
    destructive: true,
  })
  if (!confirmed) return
  await layersStore.removeLayer(props.layer.id)
}

async function toggleLayer(enabled: boolean) {
  await layersService.setLayerVisibility(
    props.layer.configuration.id,
    layersStore.layers,
    layersStore,
    mapService.mapStrategy,
    enabled,
  )
}
</script>

<template>
  <div
    class="flex items-center hover:bg-accent/50"
    :class="{
      'py-2 pl-4 pr-2 border-b border-border/50 last:border-b-0': compact,
      'p-2': !compact,
    }"
  >
    <!-- Layer Icon & Name -->
    <div
      class="flex items-center gap-2 flex-1 cursor-pointer"
      @click="openLayerConfigDialog"
    >
      <component
        v-if="getIconComponent(layer.icon)"
        :is="getIconComponent(layer.icon)"
        :class="compact ? 'size-3' : 'size-4'"
      />
      <span :class="compact ? 'text-sm' : 'text-sm font-medium'">
        {{ layer.name }}
      </span>
    </div>

    <!-- Layer Type -->
    <!-- <span class="text-xs text-muted-foreground mr-3">
      {{
        layer?.configuration?.type
          ? t(`layers.meta.fields.type.values.${layer.configuration.type}`)
          : ''
      }}
    </span> -->

    <!-- Layer Visibility Toggle -->
    <Tooltip v-if="!isDefaultLayer(layer)">
      <TooltipTrigger as-child>
        <span
          class="mr-2 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle"
        />
      </TooltipTrigger>
      <TooltipContent>
        <span>{{ t('layers.badges.custom') }}</span>
      </TooltipContent>
    </Tooltip>
    <Switch
      v-if="!groupId"
      :model-value="layer.showInLayerSelector"
      @update:model-value="toggleLayer"
      @click.stop
      @mousedown.stop
      :size="compact ? 'sm' : 'default'"
      class="mr-2"
    />

    <!-- Layer Actions -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon"
          :class="compact ? 'size-6 p-0' : 'h-6 w-6 p-0'"
          @click.stop
          @mousedown.stop
        >
          <MoreHorizontalIcon class="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click="openLayerConfigDialog">
          <PencilIcon class="size-3 mr-2" />
          {{ t('layers.actions.editLayer') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="showUngroupAction" @click="handleUngroup">
          <MoveIcon class="size-3 mr-2" />
          {{ t('layers.actions.ungroupLayer') }}
        </DropdownMenuItem>
        <DropdownMenuItem class="text-destructive" @click="deleteLayer">
          <TrashIcon class="size-3 mr-2" />
          {{ t('layers.actions.deleteLayer') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
