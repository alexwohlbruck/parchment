<script setup lang="ts">
import { ref, type Component } from 'vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDownIcon } from 'lucide-vue-next'

const props = defineProps<{
  title: string
  icon?: Component
  /** What the section already holds, shown while it's closed. */
  preview?: string
  /** Fallback when there's nothing worth previewing but values exist. */
  filled?: number
  defaultOpen?: boolean
}>()

const open = ref(props.defaultOpen ?? false)
</script>

<template>
  <Collapsible v-model:open="open">
    <CollapsibleTrigger as-child>
      <button
        type="button"
        class="group flex w-full items-center gap-2.5 rounded-md py-2 pr-1 text-left transition-colors"
      >
        <component
          :is="icon"
          v-if="icon"
          class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium leading-tight">{{ title }}</span>
          <span
            v-if="!open && preview"
            class="block truncate text-xs leading-tight text-muted-foreground"
          >
            {{ preview }}
          </span>
        </span>
        <span
          v-if="!open && !preview && filled"
          class="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {{ filled }}
        </span>
        <ChevronDownIcon
          class="size-4 shrink-0 text-muted-foreground transition-transform"
          :class="{ 'rotate-180': open }"
        />
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent class="space-y-3 pb-3 pl-[26px] pt-1">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
