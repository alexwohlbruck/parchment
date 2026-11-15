<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { MessageCircleQuestionIcon, XIcon } from 'lucide-vue-next'
import { formatTimeAgo } from '@/lib/time-format'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import type { AskThread } from '@/types/ask.types'

defineProps<{
  threads: AskThread[]
  /** Whether history is being saved; when not, the empty state says where to turn it on. */
  saving: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  remove: [id: string]
  settings: []
}>()

const { t } = useI18n()
</script>

<template>
  <EmptyState
    v-if="!threads.length"
    :icon="MessageCircleQuestionIcon"
    :title="saving ? t('ask.history.empty') : t('ask.history.off.title')"
    variant="inline"
  >
    <Button v-if="!saving" variant="outline" size="sm" @click="emit('settings')">
      {{ t('ask.history.off.action') }}
    </Button>
  </EmptyState>

  <div v-else class="flex flex-col">
    <span class="pb-1 text-[12.5px] text-muted-foreground">{{ t('ask.history.title') }}</span>
    <div
      v-for="thread in threads"
      :key="thread.id"
      class="group flex items-center gap-2 border-b border-border/50"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col py-2.5 text-left"
        @click="emit('open', thread.id)"
      >
        <span class="truncate text-[13.5px] font-medium text-foreground group-hover:text-primary transition-colors">
          {{ thread.title }}
        </span>
        <span class="text-xs text-muted-foreground">
          {{ formatTimeAgo(thread.at, t) }}
          <template v-if="thread.exchanges.length > 1">
            · {{ t('ask.history.questions', { count: thread.exchanges.length }, thread.exchanges.length) }}
          </template>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0 text-muted-foreground"
        :aria-label="t('ask.history.remove')"
        @click="emit('remove', thread.id)"
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  </div>
</template>
