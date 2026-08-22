<script setup lang="ts">
/**
 * A canvas in the library list. The switch is the point of the row: a canvas
 * is something you turn on over the main map, so toggling it has to be
 * reachable without opening it.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ItemIcon } from '@/components/ui/item-icon'
import { ItemRow } from '@/components/ui/item-row'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  LockIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import { useAppService } from '@/services/app.service'
import type { ThemeColor } from '@/lib/utils'
import type { Canvas } from '@/types/canvas.types'

const props = defineProps<{ canvas: Canvas }>()
const emit = defineEmits<{ rename: [canvas: Canvas] }>()

const router = useRouter()
const { t } = useI18n()
const canvasesService = useCanvasesService()
const canvasesStore = useCanvasesStore()
const appService = useAppService()

const displayName = computed(() => canvasesService.displayName(props.canvas))
const isPrivate = computed(() => props.canvas.scheme === 'user-e2ee')
const layerCount = computed(() => props.canvas.body?.layers?.length ?? 0)

const meta = computed(() => {
  const parts = [t('canvases.layerCount', layerCount.value)]
  if (props.canvas.description) parts.push(props.canvas.description)
  return parts.join(' · ')
})

const active = computed({
  get: () => canvasesStore.isActive(props.canvas.id),
  set: (value: boolean) => canvasesStore.setActive(props.canvas.id, value),
})

function open() {
  router.push({ name: AppRoute.CANVAS_EDITOR, params: { id: props.canvas.id } })
}

async function remove() {
  const confirmed = await appService.confirm({
    title: t('canvases.delete.title'),
    description: t('canvases.delete.description', { name: displayName.value }),
    continueText: t('general.delete'),
    destructive: true,
  })
  if (confirmed) await canvasesService.deleteCanvas(props.canvas.id)
}
</script>

<template>
  <ItemRow :title="displayName" size="md" interactive has-details @click="open">
    <template #icon="{ size }">
      <ItemIcon
        :icon="canvas.icon ?? 'MapIcon'"
        :color="(canvas.iconColor as ThemeColor) ?? 'iris'"
        :size="size"
      />
    </template>

    <template #title-trailing>
      <LockIcon v-if="isPrivate" class="size-3 text-muted-foreground shrink-0" />
    </template>

    <template #details="{ detailClass }">
      <div class="text-muted-foreground truncate" :class="detailClass">
        {{ meta }}
      </div>
    </template>

    <template #trailing>
      <Switch
        v-model="active"
        :aria-label="t('canvases.showOnMap')"
        @click.stop
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child @click.stop>
          <Button variant="ghost" size="icon" class="shrink-0">
            <MoreHorizontalIcon class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" @click.stop>
          <DropdownMenuItem @click="emit('rename', canvas)">
            <PencilIcon class="size-4" /> {{ t('canvases.actions.rename') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive" @click="remove">
            <Trash2Icon class="size-4" /> {{ t('general.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </ItemRow>
</template>
