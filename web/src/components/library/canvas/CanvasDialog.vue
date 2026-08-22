<script setup lang="ts">
/**
 * Create or rename a canvas.
 *
 * The privacy choice only appears when creating: the scheme decides where the
 * body is stored, and changing it after the fact means rewriting content the
 * server may or may not be able to read. That's a deliberate migration, not a
 * toggle, so it isn't offered here.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { IconPicker } from '@/components/ui/icon-picker'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Spinner } from '@/components/ui/spinner'
import { useCanvasesService } from '@/services/library/canvases.service'
import type { ThemeColor } from '@/lib/utils'
import type { Canvas, CanvasScheme } from '@/types/canvas.types'
import { GlobeIcon, LockIcon } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  /** Present when renaming; absent when creating. */
  canvas?: Canvas | null
}>()

const emit = defineEmits<{ created: [canvas: Canvas] }>()

const { t } = useI18n()
const canvasesService = useCanvasesService()

const name = ref('')
const description = ref('')
const icon = ref('MapIcon')
const iconColor = ref<ThemeColor>('iris')
const scheme = ref<CanvasScheme>('server-key')
const saving = ref(false)

const isEditing = computed(() => !!props.canvas)

watch(open, isOpen => {
  if (!isOpen) return
  name.value = props.canvas?.name ?? ''
  description.value = props.canvas?.description ?? ''
  icon.value = props.canvas?.icon ?? 'MapIcon'
  iconColor.value = (props.canvas?.iconColor as ThemeColor) ?? 'iris'
  scheme.value = props.canvas?.scheme ?? 'server-key'
})

const SCHEMES: { value: CanvasScheme; icon: typeof GlobeIcon }[] = [
  { value: 'server-key', icon: GlobeIcon },
  { value: 'user-e2ee', icon: LockIcon },
]

async function submit() {
  if (!name.value.trim() || saving.value) return
  saving.value = true
  try {
    if (props.canvas) {
      await canvasesService.updateMetadata(props.canvas, {
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        icon: icon.value,
        iconColor: iconColor.value,
      })
    } else {
      const created = await canvasesService.createCanvas({
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        icon: icon.value,
        iconColor: iconColor.value,
        scheme: scheme.value,
      })
      if (created) emit('created', created)
    }
    open.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t(isEditing ? 'canvases.dialog.editTitle' : 'canvases.dialog.newTitle')"
    :description="t('canvases.dialog.description')"
  >
    <template #content>
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <IconPicker
            :model-value="{ icon, color: iconColor }"
            @update:model-value="
              v => {
                icon = v.icon
                iconColor = v.color
              }
            "
          />
          <Input
            v-model="name"
            class="h-9"
            :placeholder="t('canvases.dialog.namePlaceholder')"
            @keydown.enter="submit"
          />
        </div>

        <Textarea
          v-model="description"
          :rows="2"
          :placeholder="t('canvases.dialog.descriptionPlaceholder')"
        />

        <div v-if="!isEditing" class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ t('canvases.dialog.privacy') }}
          </Label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="option in SCHEMES"
              :key="option.value"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'flex flex-col items-start gap-1 p-3 text-left transition-colors',
                option.value === scheme
                  ? 'ring-2 ring-primary bg-secondary/50'
                  : 'hover:bg-secondary/40',
              ]"
              @click="scheme = option.value"
            >
              <component :is="option.icon" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{ t(`canvases.schemes.${option.value}.title`) }}
              </span>
              <span class="text-[11px] text-muted-foreground leading-snug">
                {{ t(`canvases.schemes.${option.value}.description`) }}
              </span>
            </button>
          </div>
        </div>

        <Button class="w-full" :disabled="!name.trim() || saving" @click="submit">
          <Spinner v-if="saving" class="size-3.5" />
          {{ t(isEditing ? 'general.save' : 'general.create') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
