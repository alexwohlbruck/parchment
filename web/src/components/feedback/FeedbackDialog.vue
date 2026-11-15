<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { ImagePlusIcon, XIcon } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from '@/lib/toast'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useExternalLink } from '@/composables/useExternalLink'
import { isTauri } from '@/lib/api'
import {
  createFeedbackPortalLogin,
  submitFeedback,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_IMAGE_BYTES,
} from '@/services/feedback.service'
import { useFeedback } from '@/composables/integrations/useFeedback'

const props = defineProps<{
  open?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const isOpen = computed({
  get: () => props.open ?? false,
  set: value => emit('update:open', value),
})

const {
  boards,
  portalLoginEnabled,
  loading: loadingBoards,
  failed,
  ensureLoaded,
} = useFeedback()
const openingPortal = ref(false)
const boardId = ref<string>('')
const title = ref('')
const content = ref('')
const images = ref<{ file: File; preview: string }[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const submitting = ref(false)
const error = ref<string | null>(null)

const selectedBoard = computed(() =>
  boards.value.find(board => board.id === boardId.value),
)
const canSubmit = computed(
  () => Boolean(boardId.value) && title.value.trim().length > 0,
)

function clearImages() {
  for (const image of images.value) URL.revokeObjectURL(image.preview)
  images.value = []
}

function reset() {
  title.value = ''
  content.value = ''
  clearImages()
  error.value = null
}

onBeforeUnmount(clearImages)

function addImages(files: Iterable<File>) {
  error.value = null
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    if (images.value.length >= MAX_FEEDBACK_IMAGES) {
      error.value = t('feedback.tooManyImages', { count: MAX_FEEDBACK_IMAGES })
      break
    }
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
      error.value = t('feedback.imageTooLarge')
      continue
    }
    images.value.push({ file, preview: URL.createObjectURL(file) })
  }
}

function removeImage(index: number) {
  const [removed] = images.value.splice(index, 1)
  if (removed) URL.revokeObjectURL(removed.preview)
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  addImages(input.files ?? [])
  // Clear it so picking the same file again still fires `change`.
  input.value = ''
}

/** Pasting a screenshot into the details attaches it; text pastes as usual. */
function handlePaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])].filter(file =>
    file.type.startsWith('image/'),
  )
  if (!files.length) return
  event.preventDefault()
  addImages(files)
}

// Re-probe on open so a board added upstream shows up without a reload.
watch(isOpen, async open => {
  if (!open) return
  reset()
  await ensureLoaded(true)
  if (failed.value) error.value = t('feedback.loadFailed')
  // Keep whatever the user last picked if it still exists.
  if (!boards.value.some(board => board.id === boardId.value)) {
    boardId.value = boards.value[0]?.id ?? ''
  }
})

async function openPortal(postUrl?: string) {
  if (openingPortal.value) return
  const tab = isTauri ? null : window.open('about:blank', '_blank')
  if (!isTauri && !tab) {
    toast.error(t('feedback.popupBlocked'))
    return
  }
  if (tab) tab.opener = null
  openingPortal.value = true
  try {
    const { url } = await createFeedbackPortalLogin(postUrl)
    if (tab) {
      if (!tab.closed) tab.location.replace(url)
    } else {
      await openExternalLink(url)
    }
  } catch (err: any) {
    tab?.close()
    toast.error(t('feedback.portalFailed'), { cause: err })
  } finally {
    openingPortal.value = false
  }
}

async function handleSubmit() {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  error.value = null

  try {
    const { url } = await submitFeedback({
      boardId: boardId.value,
      title: title.value.trim(),
      content: content.value.trim(),
      images: images.value.map(image => image.file),
    })

    isOpen.value = false
    toast(t('feedback.submitted'), {
      description: t('feedback.submittedDescription'),
      ...(url
        ? {
            action: {
              label: t('feedback.viewPost'),
              onClick: () =>
                portalLoginEnabled.value
                  ? openPortal(url)
                  : openExternalLink(url, '_blank'),
            },
          }
        : {}),
    })
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? t('feedback.submitFailed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="isOpen"
    :title="t('feedback.title')"
    :description="t('feedback.description')"
  >
    <template #content>
      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <div v-if="loadingBoards" class="flex justify-center py-6">
          <Spinner />
        </div>

        <template v-else-if="boards.length">
          <!-- Not v-model: a single-select ToggleGroup deselects when you press
               the active item, which would leave no board chosen and the form
               silently unsubmittable. A board is required, so ignore that. -->
          <ToggleGroup
            :model-value="boardId"
            type="single"
            variant="outline"
            class="flex-wrap justify-start"
            @update:model-value="value => value && (boardId = value as string)"
          >
            <ToggleGroupItem
              v-for="board in boards"
              :key="board.id"
              :value="board.id"
            >
              {{ board.name }}
            </ToggleGroupItem>
          </ToggleGroup>

          <p
            v-if="selectedBoard?.description"
            class="text-sm text-muted-foreground"
          >
            {{ selectedBoard.description }}
          </p>

          <div class="flex flex-col gap-2">
            <Label for="feedback-title">{{ t('feedback.titleLabel') }}</Label>
            <Input
              id="feedback-title"
              v-model="title"
              :placeholder="t('feedback.titlePlaceholder')"
              maxlength="200"
              autofocus
            />
          </div>

          <div class="flex flex-col gap-2">
            <Label for="feedback-content">{{
              t('feedback.contentLabel')
            }}</Label>
            <Textarea
              id="feedback-content"
              v-model="content"
              :placeholder="t('feedback.contentPlaceholder')"
              maxlength="9500"
              rows="5"
              @paste="handlePaste"
            />
          </div>

          <div class="flex flex-wrap gap-2">
            <div
              v-for="(image, index) in images"
              :key="image.preview"
              class="relative size-16 overflow-hidden rounded-md border"
            >
              <img
                :src="image.preview"
                :alt="image.file.name"
                class="size-full object-cover"
              />
              <button
                type="button"
                class="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-background"
                :aria-label="t('feedback.removeImage')"
                @click="removeImage(index)"
              >
                <XIcon class="size-3" />
              </button>
            </div>

            <Button
              v-if="images.length < MAX_FEEDBACK_IMAGES"
              type="button"
              variant="outline"
              :size="images.length ? 'icon' : 'sm'"
              :class="images.length ? 'size-16' : ''"
              :aria-label="t('feedback.attachImages')"
              @click="fileInput?.click()"
            >
              <ImagePlusIcon class="size-4" />
              <span v-if="!images.length">{{ t('feedback.attachImages') }}</span>
            </Button>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="handleFileInput"
            />
          </div>
        </template>

        <Button
          v-if="portalLoginEnabled"
          type="button"
          variant="link"
          class="self-start px-0"
          :disabled="openingPortal"
          @click="openPortal()"
        >
          <Spinner v-if="openingPortal" class="size-4" />
          {{ t('feedback.openBoard') }}
        </Button>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" @click="isOpen = false">
            {{ t('general.cancel') }}
          </Button>
          <Button type="submit" :disabled="!canSubmit || submitting">
            <Spinner v-if="submitting" class="size-4" />
            {{ t('feedback.submit') }}
          </Button>
        </div>
      </form>
    </template>
  </ResponsiveDialog>
</template>
