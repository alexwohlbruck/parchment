<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ZoomIn, ZoomOut } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { toast } from '@/lib/toast'
import {
  clampCrop,
  coverScale,
  initialCrop,
  MAX_ZOOM,
  sourceRect,
  zoomAround,
  type CropState,
} from '@/lib/profile/avatar-crop'

const VIEWPORT = 256
const OUTPUT_SIZE = 512

const props = defineProps<{ file: File | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ crop: [image: Blob] }>()

const { t } = useI18n()

const image = shallowRef<HTMLImageElement | null>(null)
const crop = ref<CropState>({ x: 0, y: 0, zoom: 1 })
const saving = ref(false)

const imageSize = computed(() =>
  image.value ? { width: image.value.naturalWidth, height: image.value.naturalHeight } : null,
)

const imageStyle = computed(() => {
  if (!imageSize.value) return {}
  const scale = coverScale(imageSize.value, VIEWPORT) * crop.value.zoom
  return {
    width: `${imageSize.value.width}px`,
    height: `${imageSize.value.height}px`,
    transform: `translate(${crop.value.x}px, ${crop.value.y}px) scale(${scale})`,
  }
})

let objectUrl: string | null = null

function releaseImage() {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
  image.value = null
}

watch(
  () => props.file,
  file => {
    releaseImage()
    if (!file) return
    const url = URL.createObjectURL(file)
    objectUrl = url
    const img = new Image()
    img.onload = () => {
      if (objectUrl !== url) return
      image.value = img
      crop.value = initialCrop({ width: img.naturalWidth, height: img.naturalHeight }, VIEWPORT)
    }
    img.onerror = () => {
      if (objectUrl !== url) return
      toast.error(t('profilePhoto.unreadable'))
      open.value = false
    }
    img.src = url
  },
  { immediate: true },
)

onBeforeUnmount(releaseImage)

function setZoom(zoom: number, focus = { x: VIEWPORT / 2, y: VIEWPORT / 2 }) {
  if (!imageSize.value) return
  crop.value = zoomAround(crop.value, zoom, focus, imageSize.value, VIEWPORT)
}

const pointers = new Map<number, { x: number; y: number }>()

function pointerDistance() {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointerCenter(viewport: HTMLElement) {
  const rect = viewport.getBoundingClientRect()
  const points = [...pointers.values()]
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length - rect.left,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length - rect.top,
  }
}

function onPointerDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
}

function onPointerMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId)
  if (!previous || !imageSize.value) return
  const viewport = event.currentTarget as HTMLElement

  if (pointers.size === 2) {
    const before = pointerDistance()
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    setZoom(crop.value.zoom * (pointerDistance() / before), pointerCenter(viewport))
    return
  }

  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  crop.value = clampCrop(
    {
      ...crop.value,
      x: crop.value.x + event.clientX - previous.x,
      y: crop.value.y + event.clientY - previous.y,
    },
    imageSize.value,
    VIEWPORT,
  )
}

function onPointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId)
}

function onWheel(event: WheelEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  setZoom(crop.value.zoom * Math.exp(-event.deltaY / 300), {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  })
}

function renderCrop(): Promise<Blob | null> {
  const img = image.value!
  const rect = sourceRect(crop.value, imageSize.value!, VIEWPORT)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(OUTPUT_SIZE, Math.round(rect.size))
  canvas
    .getContext('2d')!
    .drawImage(img, rect.x, rect.y, rect.size, rect.size, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
}

async function save() {
  if (!image.value) return
  saving.value = true
  try {
    const blob = await renderCrop()
    if (!blob) throw new Error('Canvas export failed')
    emit('crop', blob)
    open.value = false
  } catch {
    toast.error(t('profilePhoto.unreadable'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ t('profilePhoto.cropTitle') }}</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col items-center gap-5">
        <div
          class="relative overflow-hidden rounded-full bg-muted touch-none select-none cursor-grab active:cursor-grabbing ring-1 ring-border"
          :style="{ width: `${VIEWPORT}px`, height: `${VIEWPORT}px` }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
        >
          <img
            v-if="image"
            :src="image.src"
            alt=""
            draggable="false"
            class="absolute left-0 top-0 max-w-none origin-top-left pointer-events-none"
            :style="imageStyle"
          />
        </div>

        <div class="flex w-full items-center gap-3 px-2">
          <ZoomOut class="size-4 shrink-0 text-muted-foreground" />
          <Slider
            class="flex-1"
            :min="1"
            :max="MAX_ZOOM"
            :step="0.01"
            :model-value="[crop.zoom]"
            :aria-label="t('profilePhoto.zoom')"
            @update:model-value="value => value && setZoom(value[0])"
          />
          <ZoomIn class="size-4 shrink-0 text-muted-foreground" />
        </div>
      </div>

      <DialogFooter>
        <Button :disabled="!image" :loading="saving" @click="save">
          {{ t('profilePhoto.save') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
