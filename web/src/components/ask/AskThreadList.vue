<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageCircleQuestionIcon, XIcon } from 'lucide-vue-next'
import { threadGroups } from '@/lib/ask/ask-threads'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import type { AskThread } from '@/types/ask.types'

const props = defineProps<{
  threads: AskThread[]
  /** Whether history is being saved; when not, the empty state says where to turn it on. */
  saving: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  remove: [id: string]
  settings: []
}>()

const { t, locale } = useI18n()

const groups = computed(() => threadGroups(props.threads, new Date()))

const clock = computed(() => new Intl.DateTimeFormat(locale.value, { hour: 'numeric', minute: '2-digit' }))
const day = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short' }))
const date = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }))

function when(thread: AskThread, group: string): string {
  if (group === 'today' || group === 'yesterday') return clock.value.format(thread.at)
  return (group === 'week' ? day : date).value.format(thread.at)
}

function snippet(thread: AskThread): string {
  return thread.exchanges.at(-1)?.text ?? ''
}
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

  <div v-else class="flex flex-col gap-4">
    <section v-for="group in groups" :key="group.key" class="flex flex-col">
      <p class="px-3 pb-1 text-xs font-medium text-muted-foreground">
        {{ t(`ask.history.groups.${group.key}`) }}
      </p>
      <div
        v-for="thread in group.threads"
        :key="thread.id"
        class="group relative flex items-center rounded-lg hover:bg-muted/60 transition-colors"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left [@media(hover:none)]:pr-10"
          @click="emit('open', thread.id)"
        >
          <span class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{{ thread.title }}</span>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground [@media(hover:hover)]:group-hover:invisible">
              {{ when(thread, group.key) }}
            </span>
          </span>
          <span v-if="snippet(thread)" class="truncate text-xs text-muted-foreground">{{ snippet(thread) }}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          :aria-label="t('ask.history.remove')"
          @click="emit('remove', thread.id)"
        >
          <XIcon class="size-3.5" />
        </Button>
      </div>
    </section>
  </div>
</template>
