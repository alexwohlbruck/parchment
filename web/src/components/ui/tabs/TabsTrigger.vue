<script setup lang="ts">
import { type HTMLAttributes, computed } from 'vue'
import { TabsTrigger, type TabsTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<
    TabsTriggerProps & {
      class?: HTMLAttributes['class']
      variant?: 'default' | 'linear'
      count?: number | null
    }
  >(),
  { variant: 'default', count: undefined },
)

const delegatedProps = computed(() => {
  const { class: _, variant: __, count: ___, ...delegated } = props
  return delegated
})

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TabsTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        variant === 'linear'
          ? 'inline-flex items-center justify-center whitespace-nowrap px-2 -mx-2 pb-2 text-sm font-medium transition-colors border-b-2 border-transparent -mb-px cursor-pointer hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground disabled:pointer-events-none disabled:opacity-50'
          : 'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent/10 hover:text-accent-foreground active:translate-y-px data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:inset-shadow-[0_1px_0_rgba(255,255,255,0.7)] data-[state=active]:dark:inset-shadow-[0_1px_0_rgba(255,255,255,0.05)]',
        props.class,
      )
    "
  >
    <slot />
    <span
      v-if="count != null"
      class="ml-1.5 text-[10px] font-bold text-muted-foreground bg-foreground/5 rounded-full px-1.5 py-0.5 leading-none"
    >{{ count }}</span>
  </TabsTrigger>
</template>
