<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'
import type { AskStep } from '@/stores/ask.store'

const props = defineProps<{
  steps: AskStep[]
  running: boolean
}>()

const { t } = useI18n()
const expanded = ref(false)
const visible = computed(() => props.running || expanded.value)
</script>

<template>
  <div class="text-sm text-muted-foreground">
    <div v-if="running && !steps.length" class="flex items-center gap-2">
      <Spinner class="size-3.5" />
      <span>{{ t('ask.starting') }}</span>
    </div>

    <button
      v-else-if="!running && steps.length"
      type="button"
      class="flex items-center gap-1 hover:text-foreground transition-colors"
      @click="expanded = !expanded"
    >
      <span>{{ t('ask.searches', steps.length) }}</span>
      <ChevronDownIcon class="size-3.5 transition-transform" :class="expanded && 'rotate-180'" />
    </button>

    <ul v-if="visible && steps.length" class="mt-1 flex flex-col gap-1">
      <li v-for="step in steps" :key="step.id" class="flex items-center gap-2">
        <Spinner v-if="step.status === 'running'" class="size-3.5" />
        <XIcon v-else-if="step.status === 'failed'" class="size-3.5 text-destructive" />
        <CheckIcon v-else class="size-3.5" />
        <span>{{ step.label }}</span>
      </li>
    </ul>
  </div>
</template>
