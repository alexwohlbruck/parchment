<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDownIcon } from 'lucide-vue-next'
import { ref } from 'vue'

interface Props {
  collapsible?: boolean
  defaultOpen?: boolean
  triggerClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  collapsible: false,
  defaultOpen: false,
  triggerClass: ''
})

const isOpen = ref(props.defaultOpen)
</script>

<template>
  <Card>
    <CardContent class="p-3">
      <template v-if="collapsible">
        <Collapsible v-model:open="isOpen">
          <CollapsibleTrigger class="w-full">
            <div class="flex items-center justify-between group" :class="triggerClass">
              <slot name="trigger" />
              <ChevronDownIcon 
                class="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground"
                :class="{ 'rotate-180': isOpen }"
              />
            </div>
          </CollapsibleTrigger>
          
          <div class="space-y-3">
            <slot name="main" />
          </div>
          
          <CollapsibleContent>
            <div class="pt-3 space-y-3 border-t border-border mt-3">
              <slot name="expanded" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
      
      <template v-else>
        <div class="space-y-3">
          <slot name="main" />
        </div>
      </template>
    </CardContent>
  </Card>
</template>
