<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRightIcon } from 'lucide-vue-next'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

defineProps<{ title: string; summary: string }>()

const open = ref(false)
</script>

<template>
  <Collapsible v-model:open="open" class="rounded-xl border border-border/50 bg-muted/40 backdrop-blur-sm">
    <CollapsibleTrigger
      class="flex w-full min-h-11 items-center gap-2 px-4 py-2.5 text-left cursor-pointer select-none"
    >
      <span class="text-xs font-semibold text-muted-foreground">{{ title }}</span>
      <span class="flex-1 truncate text-right text-xs text-muted-foreground">{{ open ? '' : summary }}</span>
      <ChevronRightIcon
        class="size-4 shrink-0 text-muted-foreground transition-transform duration-200"
        :class="open && 'rotate-90'"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="max-h-64 overflow-y-auto px-4 pb-3">
        <slot />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
