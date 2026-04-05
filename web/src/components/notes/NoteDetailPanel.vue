<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  XIcon,
  PencilLineIcon,
  ExternalLinkIcon,
  CheckCircleIcon,
  RotateCcwIcon,
  SendIcon,
} from 'lucide-vue-next'
import type { OsmNote, OsmNoteComment } from '@/types/notes.types'
import NoteComment from './NoteComment.vue'

const props = defineProps<{
  note: OsmNote | null
  loading: boolean
  isAuthenticated: boolean
}>()

const emit = defineEmits<{
  close: []
  comment: [text: string]
  'close-note': [text?: string]
  reopen: [text?: string]
}>()

const { t } = useI18n()
const router = useRouter()

const commentText = ref('')
const isSubmitting = ref(false)

const noteStatus = computed(() => {
  if (!props.note) return null
  return props.note.status
})

const osmNoteUrl = computed(() => {
  if (!props.note) return ''
  return `https://www.openstreetmap.org/note/${props.note.id}`
})

const createdDate = computed(() => {
  if (!props.note?.createdAt) return ''
  return new Date(props.note.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

async function submitComment() {
  if (!commentText.value.trim()) return
  isSubmitting.value = true
  try {
    emit('comment', commentText.value.trim())
    commentText.value = ''
  } finally {
    isSubmitting.value = false
  }
}

function handleClose() {
  emit('close-note', commentText.value.trim() || undefined)
  commentText.value = ''
}

function handleReopen() {
  emit('reopen', commentText.value.trim() || undefined)
  commentText.value = ''
}
</script>

<template>
  <PanelLayout>
    <!-- Header -->
    <div class="flex items-start justify-between gap-2 mb-4">
      <div class="flex items-center gap-2 min-w-0">
        <div class="relative shrink-0">
          <div
            class="size-8 rounded-full flex items-center justify-center"
            :style="{ backgroundColor: 'hsl(var(--primary))' }"
          >
            <PencilLineIcon class="size-4 text-white" />
          </div>
          <CheckCircleIcon
            v-if="noteStatus === 'closed'"
            class="absolute -bottom-0.5 -right-0.5 size-3.5 text-green-500 fill-white dark:fill-[#0C0C0C] drop-shadow-sm"
          />
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-semibold leading-tight">
            <template v-if="loading">
              <Skeleton class="h-5 w-32" />
            </template>
            <template v-else>
              {{ t('notes.noteTitle', { id: note?.id }) }}
            </template>
          </h2>
          <div class="flex items-center gap-2 mt-0.5" v-if="!loading && note">
            <span
              class="text-xs px-1.5 py-0.5 rounded-full font-medium"
              :class="
                noteStatus === 'open'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              "
            >
              {{ noteStatus === 'open' ? t('notes.open') : t('notes.closed') }}
            </span>
            <span class="text-xs text-muted-foreground">{{ createdDate }}</span>
          </div>
        </div>
      </div>
      <Button variant="ghost" size="icon" class="shrink-0 size-8" @click="emit('close')">
        <XIcon class="size-4" />
      </Button>
    </div>

    <!-- Loading state -->
    <template v-if="loading">
      <div class="space-y-3">
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>
    </template>

    <!-- Comments thread -->
    <template v-else-if="note">
      <div class="flex-1 space-y-3 overflow-y-auto mb-4">
        <NoteComment
          v-for="(comment, index) in note.comments"
          :key="index"
          :comment="comment"
        />
      </div>

      <!-- Actions -->
      <div class="space-y-3 mt-auto">
        <!-- View on OSM link -->
        <a
          :href="osmNoteUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          {{ t('notes.viewOnOsm') }}
          <ExternalLinkIcon class="size-3" />
        </a>

        <!-- Comment input (only if authenticated) -->
        <template v-if="isAuthenticated">
          <div class="space-y-2">
            <Textarea
              v-model="commentText"
              :placeholder="t('notes.commentPlaceholder')"
              :rows="2"
              class="resize-none"
            />
            <div class="flex items-center gap-2">
              <Button
                size="sm"
                @click="submitComment"
                :disabled="!commentText.trim() || isSubmitting"
              >
                <SendIcon class="size-3.5 mr-1" />
                {{ t('notes.comment') }}
              </Button>
              <Button
                v-if="noteStatus === 'open'"
                size="sm"
                variant="outline"
                @click="handleClose"
              >
                <CheckCircleIcon class="size-3.5 mr-1" />
                {{ t('notes.resolve') }}
              </Button>
              <Button
                v-else
                size="sm"
                variant="outline"
                @click="handleReopen"
              >
                <RotateCcwIcon class="size-3.5 mr-1" />
                {{ t('notes.reopen') }}
              </Button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </PanelLayout>
</template>
