<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CornerDownRightIcon } from 'lucide-vue-next'

defineProps<{ questions: string[] }>()
const emit = defineEmits<{ ask: [question: string] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col">
    <span class="pb-1 text-[12.5px] text-muted-foreground">{{ t('ask.followUps') }}</span>
    <button
      v-for="question in questions"
      :key="question"
      type="button"
      class="flex items-center gap-2 border-b border-border/50 py-2 text-left text-[13px] text-foreground hover:text-primary transition-colors"
      @click="emit('ask', question)"
    >
      <CornerDownRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
      {{ question }}
    </button>
  </div>
</template>
