<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArchiveIcon, ChevronDownIcon } from 'lucide-vue-next'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

const props = defineProps<{
  count: number
  /** Open regardless of the toggle, e.g. while a search is filtering the list. */
  forceOpen?: boolean
}>()

const { t } = useI18n()
const expanded = ref(false)
const open = computed({
  get: () => expanded.value || props.forceOpen,
  set: value => {
    expanded.value = value
  },
})
</script>

<template>
  <Collapsible v-if="count > 0" v-model:open="open">
    <CollapsibleTrigger
      class="group flex w-full items-center gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArchiveIcon class="size-4 shrink-0" />
      <span class="flex-1">
        {{ t('library.archived') }}
        <span class="font-normal">({{ count }})</span>
      </span>
      <ChevronDownIcon
        class="size-4 shrink-0 transition-transform"
        :class="{ 'rotate-180': open }"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="flex flex-col gap-2">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
