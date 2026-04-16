<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DetailPanelLayout from '@/components/layouts/DetailPanelLayout.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MessageSquareIcon,
  ExternalLinkIcon,
  CheckCircleIcon,
  RotateCcwIcon,
  SendIcon,
} from 'lucide-vue-next'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import type { OsmNote } from '@/types/notes.types'
import NoteComment from './NoteComment.vue'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@server/types/integration.types'

const props = defineProps<{
  note: OsmNote | null
  loading: boolean
  isAuthenticated: boolean
  submittingAction: 'comment' | 'close' | 'reopen' | null
}>()

const emit = defineEmits<{
  close: []
  comment: [text: string]
  'close-note': [text?: string]
  reopen: [text?: string]
}>()

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()

const commentText = ref('')

const noteStatus = computed(() => {
  if (!props.note) return null
  return props.note.status
})

const osmServerUrl = computed(() => {
  const config = integrationsStore.getIntegrationConfig(IntegrationId.OPENSTREETMAP)
  return (config?.serverUrl as string) || 'https://www.openstreetmap.org'
})

const osmNoteUrl = computed(() => {
  if (!props.note) return ''
  return `${osmServerUrl.value}/note/${props.note.id}`
})

const createdDate = computed(() => {
  if (!props.note?.createdAt) return ''
  return new Date(props.note.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

function submitComment() {
  if (!commentText.value.trim()) return
  emit('comment', commentText.value.trim())
  commentText.value = ''
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
  <div class="h-full flex flex-col">
    <DetailPanelLayout class="flex-1 min-h-0">
      <template #title>
        <div class="flex items-center gap-2">
          <div class="relative shrink-0">
            <div
              class="size-7 rounded-full flex items-center justify-center"
              :style="{ backgroundColor: 'hsl(var(--primary))' }"
            >
              <MessageSquareIcon class="size-3.5 text-white" />
            </div>
            <CheckCircleIcon
              v-if="noteStatus === 'closed'"
              class="absolute -bottom-0.5 -right-0.5 size-3 text-green-500 fill-white dark:fill-[#0C0C0C] drop-shadow-sm"
            />
          </div>
          <div class="min-w-0">
            <template v-if="loading">
              <Skeleton class="h-5 w-32" />
            </template>
            <template v-else>
              <h1 class="text-lg font-semibold truncate">
                {{ t('notes.noteTitle', { id: note?.id }) }}
              </h1>
            </template>
          </div>
        </div>
      </template>

      <template #actions>
        <div class="flex items-center gap-2" v-if="!loading && note">
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a :href="osmNoteUrl" target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" class="size-8">
                    <ExternalLinkIcon class="size-4" />
                  </Button>
                </a>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {{ t('notes.viewOnOsm') }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </template>

      <!-- Loading state -->
      <template v-if="loading">
        <div class="space-y-3">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>
      </template>

      <!-- Note content -->
      <template v-else-if="note">
        <!-- Comments thread (scrollable area handled by DetailPanelLayout) -->
        <div class="space-y-3">
          <NoteComment
            v-for="(comment, index) in note.comments"
            :key="index"
            :comment="comment"
          />
        </div>
      </template>
    </DetailPanelLayout>

    <!-- Fixed footer -->
    <div
      v-if="!loading && note"
      class="shrink-0 border-t border-border/50 bg-background/80 backdrop-blur-xl px-4 py-3 space-y-3"
    >
      <template v-if="isAuthenticated">
        <!-- Open note: comment box + comment/resolve buttons -->
        <div v-if="noteStatus === 'open'" class="space-y-2">
          <Textarea
            v-model="commentText"
            :placeholder="t('notes.commentPlaceholder')"
            :rows="2"
            class="resize-none"
          />
          <div class="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              :icon="SendIcon"
              :loading="submittingAction === 'comment'"
              :disabled="!commentText.trim() || !!submittingAction"
              @click="submitComment"
            >
              {{ t('notes.comment') }}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              :icon="CheckCircleIcon"
              :loading="submittingAction === 'close'"
              :disabled="!!submittingAction"
              @click="handleClose"
            >
              {{
                commentText.trim()
                  ? t('notes.commentAndResolve')
                  : t('notes.resolve')
              }}
            </Button>
          </div>
        </div>

        <!-- Closed note: reopen button only -->
        <div v-else>
          <Button
            type="button"
            size="sm"
            variant="outline"
            :icon="RotateCcwIcon"
            :loading="submittingAction === 'reopen'"
            :disabled="!!submittingAction"
            @click="handleReopen"
          >
            {{ t('notes.reopen') }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
