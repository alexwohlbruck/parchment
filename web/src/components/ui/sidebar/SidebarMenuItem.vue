<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
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
    /** A muted second line under the label. */
    description?: string
    icon?: Icon
    /** Makes the row a link. A path string marks the row active for its whole subtree. */
    to?: RouteLocationRaw
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
const router = useRouter()
const { collapsed } = useSidebar()

const isActive = computed(() => {
  if (props.active !== undefined) return props.active
  if (!props.to) return false
  if (typeof props.to === 'string') return route.path.startsWith(props.to)
  return router.resolve(props.to).path === route.path
})

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
              description && 'h-12',
              'relative w-full flex items-center cursor-pointer no-underline',
              'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
              'text-foreground',
              !isActive && 'hover:bg-foreground/5',
            )
          "
          @click="$emit('click', $event)"
        >
          <!-- Up to 28px, overhanging the 20px column evenly so it stays centred in the rail. -->
          <span v-if="$slots.icon" class="flex items-center justify-center shrink-0 size-5 mr-1">
            <slot name="icon" />
          </span>
          <span v-else-if="icon" class="relative shrink-0">
            <component
              :is="icon"
              class="size-5 transition-colors"
              :class="isActive ? 'text-primary' : 'text-current'"
            />
            <span
              v-if="$slots.indicator"
              class="absolute -top-0.5 -right-0.5"
            >
              <slot name="indicator" />
            </span>
          </span>
          <span
            class="flex-1 min-w-0 flex flex-col text-left transition-opacity duration-150"
            :class="collapsed ? 'opacity-0' : 'opacity-100'"
          >
            <span class="truncate">{{ label }}</span>
            <span
              v-if="description"
              class="truncate text-xs font-normal text-muted-foreground"
            >
              {{ description }}
            </span>
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
