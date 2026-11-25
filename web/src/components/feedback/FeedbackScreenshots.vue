<script setup lang="ts">
import { ref, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ImagePlusIcon, XIcon } from 'lucide-vue-next'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'

const MAX_SCREENSHOTS = 4
const MAX_SIZE = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const screenshots = defineModel<File[]>({ required: true })

const { t } = useI18n()
const input = ref<HTMLInputElement>()
const previews = new Map<File, string>()

function previewOf(file: File) {
  let url = previews.get(file)
  if (!url) previews.set(file, (url = URL.createObjectURL(file)))
  return url
}

function releasePreviews(keep: File[] = []) {
  for (const [file, url] of previews) {
    if (keep.includes(file)) continue
    URL.revokeObjectURL(url)
    previews.delete(file)
  }
}

watch(screenshots, releasePreviews)
onBeforeUnmount(() => releasePreviews())

function add(files: File[]) {
  const images = files.filter(file => ACCEPTED_TYPES.includes(file.type))
  if (images.length < files.length) toast.error(t('feedback.screenshotType'))

  const fitting = images.filter(file => file.size <= MAX_SIZE)
  if (fitting.length < images.length) toast.error(t('feedback.screenshotTooLarge'))

  const room = MAX_SCREENSHOTS - screenshots.value.length
  if (fitting.length > room) toast.error(t('feedback.screenshotLimit'))

  if (room > 0 && fitting.length) {
    screenshots.value = [...screenshots.value, ...fitting.slice(0, room)]
  }
}

function remove(file: File) {
  screenshots.value = screenshots.value.filter(other => other !== file)
}

function onPick(event: Event) {
  const target = event.target as HTMLInputElement
  add(Array.from(target.files ?? []))
  target.value = ''
}

defineExpose({ add })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div
      v-for="(file, index) in screenshots"
      :key="previewOf(file)"
      class="relative size-16 overflow-hidden rounded-md border"
    >
      <img
        :src="previewOf(file)"
        :alt="t('feedback.screenshotAlt', { n: index + 1 })"
        class="size-full object-cover"
      />
      <button
        type="button"
        class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur-sm"
        :aria-label="t('feedback.removeScreenshot')"
        @click="remove(file)"
      >
        <XIcon class="size-3" />
      </button>
    </div>

    <Button
      v-if="screenshots.length < MAX_SCREENSHOTS"
      type="button"
      variant="outline"
      size="sm"
      class="gap-2"
      @click="input?.click()"
    >
      <ImagePlusIcon class="size-4" />
      {{ t('feedback.addScreenshot') }}
    </Button>

    <input
      ref="input"
      type="file"
      :accept="ACCEPTED_TYPES.join(',')"
      multiple
      class="hidden"
      @change="onPick"
    />
  </div>
</template>
