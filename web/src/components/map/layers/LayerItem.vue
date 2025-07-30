<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import type { Layer } from '@/types/map.types'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontalIcon, PencilIcon, MoveIcon } from 'lucide-vue-next'
import LayerConfiguration from './LayerConfiguration.vue'

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
const mapService = useMapService()
const appService = useAppService()

function openLayerConfigDialog() {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layerId: props.layer.configuration?.id,
    },
  })
}

function handleUngroup() {
  const layerId = props.layer.configuration?.id
  if (layerId) {
    emit('ungroup', layerId)
  }
}

function toggleLayer(enabled: boolean) {
  mapService.toggleLayer(props.layer.configuration?.id, enabled)
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
        v-if="layer.icon"
        :is="layer.icon"
        :class="compact ? 'size-3' : 'size-4'"
      />
      <span :class="compact ? 'text-sm' : 'text-sm font-medium'">
        {{ layer.name }}
      </span>
    </div>

    <!-- Layer Type -->
    <span class="text-xs text-muted-foreground mr-3">
      {{
        layer?.configuration?.type
          ? t(`layers.meta.fields.type.values.${layer.configuration.type}`)
          : ''
      }}
    </span>

    <!-- Layer Visibility Toggle -->
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
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
