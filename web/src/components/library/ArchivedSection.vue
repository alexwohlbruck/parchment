<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArchiveIcon, ChevronDownIcon } from 'lucide-vue-next'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { SectionHeader } from '@/components/ui/section-header'

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
    <CollapsibleTrigger as-child>
      <SectionHeader
        :title="t('library.archived')"
        :icon="ArchiveIcon"
        :count="count"
        clickable
        class="py-2"
      >
        <template #trailing>
          <ChevronDownIcon
            class="size-4 shrink-0 text-muted-foreground transition-transform"
            :class="{ 'rotate-180': open }"
          />
        </template>
      </SectionHeader>
    </CollapsibleTrigger>
    <CollapsibleContent class="flex flex-col gap-2">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
