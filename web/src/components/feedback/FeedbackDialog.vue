<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useExternalLink } from '@/composables/useExternalLink'
import { submitFeedback } from '@/services/feedback.service'
import { useFeedback } from '@/composables/useFeedback'

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

const { boards, loading: loadingBoards, failed, ensureLoaded } = useFeedback()
const boardId = ref<string>('')
const title = ref('')
const content = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

const selectedBoard = computed(() =>
  boards.value.find(board => board.id === boardId.value),
)
const canSubmit = computed(
  () => Boolean(boardId.value) && title.value.trim().length > 0,
)

function reset() {
  title.value = ''
  content.value = ''
  error.value = null
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

async function handleSubmit() {
  if (!canSubmit.value || submitting.value) return

  submitting.value = true
  error.value = null

  try {
    const { url } = await submitFeedback({
      boardId: boardId.value,
      title: title.value.trim(),
      content: content.value.trim(),
    })

    isOpen.value = false
    toast(t('feedback.submitted'), {
      description: t('feedback.submittedDescription'),
      ...(url
        ? {
            action: {
              label: t('feedback.viewPost'),
              onClick: () => openExternalLink(url, '_blank'),
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
          <ToggleGroup
            v-model="boardId"
            type="single"
            variant="outline"
            class="flex-wrap justify-start"
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
            <Label for="feedback-content">{{ t('feedback.contentLabel') }}</Label>
            <Textarea
              id="feedback-content"
              v-model="content"
              :placeholder="t('feedback.contentPlaceholder')"
              maxlength="10000"
              rows="5"
            />
          </div>
      </template>

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
