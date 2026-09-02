<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import type { Icon } from '@/types/app.types'
import type { Hotkey } from '@/types/command.types'
import { useSidebar } from './context'
import { SIDEBAR_ROW } from './scale'

/**
 * One row: icon, label, and — when there is one — the shortcut that fires it.
 *
 * A row with `to` renders a real link so middle-click and copy-link behave;
 * callers that need to do something extra on click can still listen, and
 * `preventDefault` to suppress the navigation.
 *
 * The row paints no background of its own when active — `SidebarMenu`'s
 * travelling chip does that. Collapsed, the label is clipped by the sidebar
 * rather than unmounted, so expanding reveals text that is already in place,
 * and the tooltip takes over as the row's name.
 */
const props = withDefaults(
  defineProps<{
    label: string
    icon?: Icon
    /** Makes the row a link. */
    to?: string
    /** Overrides the route-derived active state. */
    active?: boolean
    hotkey?: Hotkey
    hotkeyId?: string
    commandId?: string
  }>(),
  // Absent boolean props are cast to `false` unless a default is declared, and
  // `false` would beat the route check every time.
  { active: undefined },
)

defineEmits<{ (e: 'click', event: MouseEvent): void }>()

const route = useRoute()
const { collapsed } = useSidebar()

const isActive = computed(() =>
  props.active ?? (props.to ? route.path.startsWith(props.to) : false),
)

const hasShortcut = computed(
  () => !!(props.hotkey || props.hotkeyId || props.commandId),
)

// `hotkey` is a literal key combo; the other two resolve one from a store, and
// passing both leaves Kbd's union prop ambiguous.
const shortcutProps = computed(() =>
  props.hotkeyId
    ? { hotkeyId: props.hotkeyId }
    : props.commandId
      ? { commandId: props.commandId }
      : { hotkey: props.hotkey! },
)
</script>

<template>
  <li :data-active="isActive">
    <Tooltip :disabled="!collapsed">
      <TooltipTrigger as-child>
        <component
          :is="to ? RouterLink : 'button'"
          :to="to"
          :type="to ? undefined : 'button'"
          :aria-current="to && isActive ? 'page' : undefined"
          :class="
            cn(
              SIDEBAR_ROW,
              'relative w-full flex items-center cursor-pointer no-underline',
              'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
              'text-foreground',
              !isActive && 'hover:bg-foreground/5',
            )
          "
          @click="$emit('click', $event)"
        >
          <component
            :is="icon"
            v-if="icon"
            class="size-5 shrink-0 transition-colors"
            :class="isActive ? 'text-primary' : 'text-current'"
          />
          <span
            class="flex-1 text-left whitespace-nowrap transition-opacity duration-150"
            :class="collapsed ? 'opacity-0' : 'opacity-100'"
          >
            {{ label }}
          </span>
          <Kbd
            v-if="hasShortcut"
            v-bind="shortcutProps"
            class="transition-opacity duration-150"
            :class="collapsed ? 'opacity-0' : 'opacity-100'"
          />
        </component>
      </TooltipTrigger>

      <TooltipContent side="right" :side-offset="10" class="flex items-center gap-2">
        <span class="leading-none">{{ label }}</span>
        <Kbd v-if="hasShortcut" v-bind="shortcutProps" />
      </TooltipContent>
    </Tooltip>
  </li>
</template>
