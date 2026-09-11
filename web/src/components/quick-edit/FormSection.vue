<script setup lang="ts">
import { ref } from 'vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDownIcon } from 'lucide-vue-next'

const props = defineProps<{
  title: string
  /** How many fields in this section already have a value. */
  filled?: number
  defaultOpen?: boolean
}>()

const open = ref(props.defaultOpen ?? false)
</script>

<template>
  <Collapsible v-model:open="open" class="border-t border-border pt-2">
    <CollapsibleTrigger as-child>
      <button
        type="button"
        class="flex w-full items-center justify-between py-1 text-left text-sm font-medium transition-colors hover:text-foreground"
        :class="open ? 'text-foreground' : 'text-muted-foreground'"
      >
        <span class="flex items-center gap-2">
          {{ title }}
          <span
            v-if="filled"
            class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
          >
            {{ filled }}
          </span>
        </span>
        <ChevronDownIcon
          class="size-4 shrink-0 transition-transform"
          :class="{ 'rotate-180': open }"
        />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent class="space-y-3 pb-2 pt-2">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
