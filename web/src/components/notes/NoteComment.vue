<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { OsmNoteComment } from '@/types/notes.types'

const props = defineProps<{
  comment: OsmNoteComment
}>()

const { t } = useI18n()

const formattedDate = computed(() => {
  return new Date(props.comment.date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const displayName = computed(() => {
  return props.comment.user || t('notes.anonymous')
})

const initial = computed(() => {
  return displayName.value[0]?.toUpperCase() ?? '?'
})

const isAction = computed(() => {
  return props.comment.action === 'closed' || props.comment.action === 'reopened'
})

const osmUserUrl = computed(() => {
  if (!props.comment.user) return null
  return `https://www.openstreetmap.org/user/${encodeURIComponent(props.comment.user)}`
})
</script>

<template>
  <!-- System action (closed/reopened) -->
  <div v-if="isAction && !comment.text" class="flex items-center gap-2 text-xs text-muted-foreground py-1">
    <span class="h-px flex-1 bg-border" />
    <span>
      <a
        v-if="osmUserUrl"
        :href="osmUserUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium hover:text-foreground transition-colors"
      >{{ displayName }}</a>
      <span v-else class="font-medium">{{ displayName }}</span>
      {{ ' ' }}
      {{ comment.action === 'closed' ? t('notes.actionClosed') : t('notes.actionReopened') }}
    </span>
    <span class="h-px flex-1 bg-border" />
  </div>

  <!-- Comment with text -->
  <div v-else class="flex gap-2">
    <Avatar size="xs" class="shrink-0 mt-0.5">
      <AvatarFallback class="text-[10px]">{{ initial }}</AvatarFallback>
    </Avatar>
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline gap-1.5">
        <a
          v-if="osmUserUrl"
          :href="osmUserUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-medium hover:text-primary transition-colors"
        >{{ displayName }}</a>
        <span v-else class="text-sm font-medium">{{ displayName }}</span>
        <span class="text-xs text-muted-foreground">{{ formattedDate }}</span>
      </div>
      <p class="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">{{ comment.text }}</p>
    </div>
  </div>
</template>
