<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  markRaw,
  type Component,
} from 'vue'
import { useResponsive } from '@/lib/utils'
import { useRouter } from 'vue-router'
import BottomSheet from '@/components/BottomSheet.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'

export interface MenuItem {
  type: 'item'
  id?: string
  label: string
  icon?: Component
  disabled?: boolean
  to?: string
  href?: string
  onSelect?: () => void | Promise<void>
}

export interface MenuSeparator {
  type: 'separator'
  id?: string
}

export interface MenuLabel {
  type: 'label'
  id?: string
  label: string
}

export interface MenuSubmenu {
  type: 'submenu'
  id?: string
  label: string
  icon?: Component
  disabled?: boolean
  items: MenuItemDefinition[]
}

export type MenuItemDefinition =
  | MenuItem
  | MenuSeparator
  | MenuLabel
  | MenuSubmenu

const props = withDefaults(
  defineProps<{
    open?: boolean
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
    contentClass?: string
    items?: MenuItemDefinition[]
    customComponent?: Component
    customProps?: Record<string, any>
    title?: string
    description?: string
    peekHeight?: number | string
    customSnapPoints?: (number | string)[]
    showDragHandle?: boolean
    showCloseButton?: boolean
  }>(),
  {
    align: 'start',
    side: 'bottom',
    sideOffset: 0,
    showDragHandle: true,
    showCloseButton: false,
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

interface SheetLayer {
  id: string
  title?: string
  items: MenuItemDefinition[]
  open: boolean
}

const { isMobileScreen } = useResponsive()
const router = useRouter()
const internalOpen = ref(props.open ?? false)
const sheetStack = ref<SheetLayer[]>([])
const historyId = ref<string>(`dropdown-${Date.now()}-${Math.random()}`)
const isHandlingPopState = ref(false)

const SafeCustomComponent = props.customComponent
  ? markRaw(props.customComponent)
  : null

watch(
  () => props.open,
  newValue => {
    if (newValue !== undefined) {
      internalOpen.value = newValue
    }
  },
)

watch(internalOpen, newValue => {
  if (isHandlingPopState.value) return

  emit('update:open', newValue)

  if (newValue) {
    // Initialize the first sheet layer when opening
    if (sheetStack.value.length === 0) {
      sheetStack.value.push({
        id: `sheet-${Date.now()}-0`,
        title: props.title,
        items: props.items || [],
        open: true,
      })
    }
  } else {
    // Clear all sheets when closing
    sheetStack.value.forEach(sheet => {
      sheet.open = false
    })
    setTimeout(() => {
      sheetStack.value = []
    }, 300) // Wait for animation to complete
  }
})

function handlePopState(event: PopStateEvent) {
  if (!isMobileScreen.value) return

  const state = event.state

  if (state?.dropdownId === historyId.value) {
    isHandlingPopState.value = true

    const targetDepth = state.submenuDepth || 0
    const currentDepth = sheetStack.value.length

    if (targetDepth < currentDepth) {
      if (targetDepth === 0) {
        // Close all sheets
        handleOpenChange(false)
      } else {
        // Close sheets until we reach the target depth
        while (sheetStack.value.length > targetDepth) {
          const sheet = sheetStack.value[sheetStack.value.length - 1]
          if (sheet) {
            sheet.open = false
          }
          setTimeout(() => {
            sheetStack.value.pop()
          }, 300)
        }
      }
    }

    isHandlingPopState.value = false
  } else if (
    internalOpen.value &&
    (!state || state.dropdownId !== historyId.value)
  ) {
    isHandlingPopState.value = true
    handleOpenChange(false)
    isHandlingPopState.value = false
  }
}

onMounted(() => {
  window.addEventListener('popstate', handlePopState)
})

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
})

function handleOpenChange(value: boolean) {
  internalOpen.value = value
}

function handleItemClick(item: MenuItem) {
  if (item.disabled) return

  if (item.to) {
    router.push(item.to)
  } else if (item.href) {
    window.open(item.href, '_blank')
  }

  item.onSelect?.()
  handleOpenChange(false)
}

function openSubmenu(submenu: MenuSubmenu) {
  if (submenu.disabled) return

  if (isMobileScreen.value) {
    const newDepth = sheetStack.value.length
    const newSheet: SheetLayer = {
      id: `sheet-${Date.now()}-${newDepth}`,
      title: submenu.label,
      items: submenu.items,
      open: true,
    }
    sheetStack.value.push(newSheet)

    // Add to browser history
    if (!isHandlingPopState.value) {
      window.history.pushState(
        {
          dropdownId: historyId.value,
          submenuDepth: sheetStack.value.length,
        },
        '',
      )
    }
  }
}

function closeTopSheet(sheetId: string) {
  const sheetIndex = sheetStack.value.findIndex(s => s.id === sheetId)
  if (sheetIndex === -1) return

  const sheet = sheetStack.value[sheetIndex]
  sheet.open = false

  // Remove from stack after animation
  setTimeout(() => {
    sheetStack.value.splice(sheetIndex, 1)

    // If we closed the last sheet, close the entire dropdown
    if (sheetStack.value.length === 0) {
      handleOpenChange(false)
    }
  }, 300)
}

// Calculate snap points for nested sheets - each one is slightly less tall
function getSnapPointsForSheet(index: number): (number | string)[] {
  if (index === 0) {
    // First sheet uses the original snap points
    return props.customSnapPoints || [props.peekHeight ?? '250px', 0.5, 1]
  }

  // For nested sheets, reduce each snap point by a small offset
  const baseSnapPoints = props.customSnapPoints || [
    props.peekHeight ?? '250px',
    0.5,
    1,
  ]
  const reductionPerLevel = 0.05 // Reduce by 5% per level

  return baseSnapPoints.map(point => {
    if (typeof point === 'number') {
      // If it's a decimal (percentage), subtract the reduction
      if (point > 0 && point <= 1) {
        return Math.max(0.3, point - reductionPerLevel * index)
      }
      // If it's pixels, subtract a pixel amount
      return Math.max(150, point - 20 * index)
    } else if (typeof point === 'string' && point.endsWith('px')) {
      // Parse pixel values and reduce them
      const pixels = parseFloat(point)
      return `${Math.max(150, pixels - 20 * index)}px`
    }
    return point
  })
}
</script>

<template>
  <div v-if="isMobileScreen">
    <BottomSheet
      v-for="(sheet, index) in sheetStack"
      :key="sheet.id"
      modal
      :parent-id="`${historyId}-${sheet.id}`"
      v-model:open="sheet.open"
      :custom-snap-points="getSnapPointsForSheet(index)"
      :show-drag-handle="showDragHandle"
      :show-close-button="showCloseButton"
      :dismissable="true"
      :track-obstructing="false"
      obstructing-key="responsive-dropdown"
      :z-index-offset="index * 20"
      @update:open="open => !open && closeTopSheet(sheet.id)"
    >
      <div v-if="SafeCustomComponent && index === 0">
        <component :is="SafeCustomComponent" v-bind="customProps" />
      </div>

      <div v-else>
        <div
          v-if="sheet.title || (description && index === 0)"
          class="mb-4 mx-3"
        >
          <h2 v-if="sheet.title" class="text-lg font-semibold">
            {{ sheet.title }}
          </h2>
          <p
            v-if="description && index === 0"
            class="text-sm text-muted-foreground mt-1"
          >
            {{ description }}
          </p>
        </div>

        <div>
          <template
            v-for="(item, itemIndex) in sheet.items"
            :key="item.id || itemIndex"
          >
            <Separator v-if="item.type === 'separator'" class="my-1.5" />

            <div
              v-else-if="item.type === 'label'"
              class="px-2 py-1.5 text-sm font-semibold"
            >
              {{ item.label }}
            </div>

            <Button
              v-else-if="item.type === 'item'"
              variant="ghost"
              class="w-full justify-start h-auto px-3 py-2.5 gap-2"
              :disabled="item.disabled"
              @click="handleItemClick(item)"
            >
              <component
                v-if="item.icon"
                :is="item.icon"
                class="size-4 shrink-0"
              />
              <span>{{ item.label }}</span>
            </Button>

            <Button
              v-else-if="item.type === 'submenu'"
              variant="ghost"
              class="w-full justify-start h-auto px-3 py-2.5 gap-2"
              :disabled="item.disabled"
              @click="openSubmenu(item)"
            >
              <component
                v-if="item.icon"
                :is="item.icon"
                class="size-4 shrink-0"
              />
              <span class="flex-1 text-left">{{ item.label }}</span>
              <ChevronRightIcon class="size-4 shrink-0" />
            </Button>
          </template>
        </div>
      </div>
    </BottomSheet>
  </div>

  <DropdownMenu v-else v-model:open="internalOpen">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" :open="() => handleOpenChange(true)" />
    </DropdownMenuTrigger>

    <DropdownMenuContent
      :align="align"
      :side="side"
      :side-offset="sideOffset"
      :class="contentClass"
    >
      <component
        v-if="SafeCustomComponent"
        :is="SafeCustomComponent"
        v-bind="customProps"
      />

      <template v-else>
        <template v-for="(item, index) in items" :key="item.id || index">
          <DropdownMenuSeparator v-if="item.type === 'separator'" />

          <DropdownMenuLabel v-else-if="item.type === 'label'">
            {{ item.label }}
          </DropdownMenuLabel>

          <DropdownMenuItem
            v-else-if="item.type === 'item'"
            :disabled="item.disabled"
            @click="handleItemClick(item)"
          >
            <component v-if="item.icon" :is="item.icon" class="size-4" />
            <span>{{ item.label }}</span>
          </DropdownMenuItem>

          <DropdownMenuSub v-else-if="item.type === 'submenu'">
            <DropdownMenuSubTrigger>
              <component v-if="item.icon" :is="item.icon" class="size-4" />
              <span>{{ item.label }}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <template
                  v-for="(subItem, subIndex) in item.items"
                  :key="subItem.id || subIndex"
                >
                  <DropdownMenuSeparator v-if="subItem.type === 'separator'" />

                  <DropdownMenuLabel v-else-if="subItem.type === 'label'">
                    {{ subItem.label }}
                  </DropdownMenuLabel>

                  <DropdownMenuItem
                    v-else-if="subItem.type === 'item'"
                    :disabled="subItem.disabled"
                    @click="handleItemClick(subItem)"
                  >
                    <component
                      v-if="subItem.icon"
                      :is="subItem.icon"
                      class="size-4"
                    />
                    <span>{{ subItem.label }}</span>
                  </DropdownMenuItem>
                </template>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </template>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
