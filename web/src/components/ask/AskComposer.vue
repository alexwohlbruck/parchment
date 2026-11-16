<script setup lang="ts">
import { ArrowUpIcon } from 'lucide-vue-next'

defineProps<{
  placeholder: string
  disabled?: boolean
  autofocus?: boolean
}>()
const emit = defineEmits<{ submit: [] }>()
const question = defineModel<string>({ required: true })
</script>

<template>
  <form
    class="flex items-center gap-2 rounded-2xl border border-border/80 bg-card/90 py-1.5 pl-4 pr-1.5 shadow-sm backdrop-blur-xl focus-within:border-ring/60 transition-colors"
    @submit.prevent="emit('submit')"
  >
    <input
      v-model="question"
      :placeholder="placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      enterkeyhint="send"
      class="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
    />
    <button
      type="submit"
      :disabled="disabled || !question.trim()"
      :aria-label="placeholder"
      class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-25"
    >
      <ArrowUpIcon class="size-4" />
    </button>
  </form>
</template>
