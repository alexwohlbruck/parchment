<script setup lang="ts">
import { ref, watch, nextTick, markRaw, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useExternalLink } from '@/composables/useExternalLink'
import {
  useResponsiveOverlay,
  computeSnapPoints,
  type ResponsiveOverlayBaseProps,
  type ResponsiveOverlayPositionProps,
  type ResponsiveOverlayTitleProps,
} from '@/composables/useResponsiveOverlay'
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
import { ChevronRight, ChevronLeft } from 'lucide-vue-next'

export interface MenuItem {
  type: 'item'
  id?: string
  label: string
  icon?: Component
  trailing?: Component
  trailingProps?: Record<string, any>
  disabled?: boolean
  variant?: 'default' | 'destructive'
  to?: string
  href?: string
  keepOpen?: boolean
  onSelect?: () => void | Promise<void>
}

export interface MenuSeparator {
  type: 'separator'
  id?: string
}

export interface MenuLabel {
  type: 'label'
  id?: string
  label?: string
  customComponent?: Component
  customProps?: Record<string, any>
}

export interface MenuSubmenu {
  type: 'submenu'
  id?: string
  label: string
  icon?: Component
  disabled?: boolean
  items?: MenuItemDefinition[]
  customComponent?: Component
  customProps?: Record<string, any>
}

export interface MenuCustom {
  type: 'custom'
  id?: string
  component: Component
  props?: Record<string, any>
}

export type MenuItemDefinition =
  | MenuItem
  | MenuSeparator
  | MenuLabel
  | MenuSubmenu
  | MenuCustom

interface Props
  extends ResponsiveOverlayBaseProps,
    ResponsiveOverlayPositionProps,
    ResponsiveOverlayTitleProps {
  contentClass?: string
  items?: MenuItemDefinition[]
  customComponent?: Component
  customProps?: Record<string, any>
}

const props = withDefaults(defineProps<Props>(), {
  align: 'start',
  side: 'bottom',
  sideOffset: 0,
  showDragHandle: true,
  showCloseButton: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { isMobileScreen, internalOpen, handleOpenChange } = useResponsiveOverlay(
  {
    getOpen: () => props.open,
    emit,
    cleanupBodyStyles: true,
  },
)

const router = useRouter()
const { openExternalLink } = useExternalLink()

const SafeCustomComponent = props.customComponent
  ? markRaw(props.customComponent)
  : null

// Submenu stack for mobile nested bottom sheets
interface SubmenuStackEntry {
  submenu: MenuSubmenu
  open: boolean
}

const submenuStack = ref<SubmenuStackEntry[]>([])

// Clear submenu stack when main menu closes
watch(internalOpen, isOpen => {
  if (!isOpen) {
    submenuStack.value = []
  }
})

async function openSubmenu(submenu: MenuSubmenu) {
  if (submenu.disabled) return

  const index = submenuStack.value.length

  // Push with open: false first so the component mounts
  submenuStack.value = [
    ...submenuStack.value,
    {
      submenu,
      open: false,
    },
  ]

  // Wait for the component to mount, then open it
  await nextTick()

  // Update the array immutably to ensure reactivity
  submenuStack.value = submenuStack.value.map((entry, i) =>
    i === index ? { ...entry, open: true } : entry,
  )
}

function closeSubmenu(index: number) {
  if (index >= 0 && index < submenuStack.value.length) {
    // First close the sheet
    submenuStack.value = submenuStack.value.map((entry, i) =>
      i === index ? { ...entry, open: false } : entry,
    )
    // Remove this and all deeper submenus after animation completes
    setTimeout(() => {
      submenuStack.value = submenuStack.value.slice(0, index)
    }, 300)
  }
}

function handleSubmenuOpenChange(index: number, isOpen: boolean) {
  console.log('LOG: handleSubmenuOpenChange', isOpen)
  if (!isOpen) {
    console.log('LOG: closing submenu')
    // closeSubmenu(index) // TODO: This is called when submenu opens with suprious open events from reka dialog
  }
}

function handleItemClick(item: MenuItem, event?: Event) {
  if (item.disabled) return

  if (item.to) {
    router.push(item.to)
  } else if (item.href) {
    openExternalLink(item.href, '_blank')
  }

  item.onSelect?.()

  // Only close menu if keepOpen is not set
  if (!item.keepOpen) {
    submenuStack.value = []
    handleOpenChange(false)
  }
}

const snapPoints = computeSnapPoints(props.customSnapPoints, props.peekHeight)
</script>

<template>
  <!-- Mobile: Trigger + Bottom Sheet -->
  <template v-if="isMobileScreen">
    <slot name="trigger" :open="() => handleOpenChange(true)" />

    <!-- Main bottom sheet -->
    <BottomSheet
      modal
      v-model:open="internalOpen"
      :custom-snap-points="snapPoints"
      :show-drag-handle="showDragHandle"
      :show-close-button="showCloseButton"
      :dismissable="true"
      :track-obstructing="false"
      obstructing-key="responsive-dropdown"
      @update:open="handleOpenChange"
    >
      <div v-if="SafeCustomComponent">
        <component :is="SafeCustomComponent" v-bind="customProps" />
      </div>

      <div v-else>
        <!-- Header slot -->
        <slot name="header" />

        <div v-if="(title || description) && !$slots.header" class="mb-4 mx-3">
          <h2 v-if="title" class="text-lg font-semibold">
            {{ title }}
          </h2>
          <p v-if="description" class="text-sm text-muted-foreground mt-1">
            {{ description }}
          </p>
        </div>

        <div class="px-2">
          <template
            v-for="(item, itemIndex) in items"
            :key="item.id || itemIndex"
          >
            <Separator v-if="item.type === 'separator'" class="my-1.5" />

            <!-- Label with optional custom component -->
            <template v-else-if="item.type === 'label'">
              <component
                v-if="item.customComponent"
                :is="markRaw(item.customComponent)"
                v-bind="item.customProps"
              />
              <div v-else class="px-2 py-1.5 text-sm font-semibold">
                {{ item.label }}
              </div>
            </template>

            <!-- Custom component -->
            <component
              v-else-if="item.type === 'custom'"
              :is="markRaw(item.component)"
              v-bind="item.props"
            />

            <!-- Regular item with optional trailing component -->
            <Button
              v-else-if="item.type === 'item'"
              variant="ghost"
              class="w-full h-auto px-3 py-2.5 gap-2"
              :class="[
                item.trailing ? 'justify-between' : 'justify-start',
                {
                  'text-destructive hover:text-destructive':
                    item.variant === 'destructive' && !item.disabled,
                  'opacity-50 cursor-not-allowed': item.disabled,
                },
              ]"
              :disabled="item.disabled"
              @click="handleItemClick(item, $event)"
            >
              <span class="flex items-center gap-2">
                <component
                  v-if="item.icon"
                  :is="item.icon"
                  :class="[
                    'size-4 shrink-0',
                    {
                      'text-destructive':
                        item.variant === 'destructive' && !item.disabled,
                    },
                  ]"
                />
                <span>{{ item.label }}</span>
              </span>
              <component
                v-if="item.trailing"
                :is="item.trailing"
                v-bind="item.trailingProps"
                @click.stop
              />
            </Button>

            <!-- Submenu trigger -->
            <Button
              v-else-if="item.type === 'submenu'"
              variant="ghost"
              class="w-full justify-between h-auto px-3 py-2.5"
              :class="{
                'opacity-50 cursor-not-allowed': item.disabled,
              }"
              :disabled="item.disabled"
              @click="openSubmenu(item)"
            >
              <span class="flex items-center gap-2">
                <component
                  v-if="item.icon"
                  :is="item.icon"
                  class="size-4 shrink-0"
                />
                <span>{{ item.label }}</span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </template>
        </div>

        <!-- Footer slot -->
        <slot name="footer" />
      </div>
    </BottomSheet>

    <!-- Nested submenu bottom sheets -->
    <template v-for="(entry, index) in submenuStack" :key="index">
      <BottomSheet
        modal
        :open="entry.open"
        :custom-snap-points="snapPoints"
        :show-drag-handle="showDragHandle"
        :show-close-button="false"
        :dismissable="true"
        :track-obstructing="false"
        :obstructing-key="`responsive-dropdown-submenu-${index}`"
        @update:open="(val: boolean) => handleSubmenuOpenChange(index, val)"
      >
        <div v-if="entry.submenu.customComponent">
          <component
            :is="markRaw(entry.submenu.customComponent)"
            v-bind="entry.submenu.customProps"
          />
        </div>

        <div v-else>
          <!-- Submenu header with back button -->
          <div class="flex items-center gap-2 mb-4 mx-1">
            <Button
              variant="ghost"
              size="icon"
              class="size-8 shrink-0"
              @click="closeSubmenu(index)"
            >
              <ChevronLeft class="size-4" />
            </Button>
            <h2 class="text-lg font-semibold">
              {{ entry.submenu.label }}
            </h2>
          </div>

          <div class="px-2">
            <template
              v-for="(subItem, subIndex) in entry.submenu.items"
              :key="subItem.id || subIndex"
            >
              <Separator v-if="subItem.type === 'separator'" class="my-1.5" />

              <div
                v-else-if="subItem.type === 'label'"
                class="px-2 py-1.5 text-sm font-semibold"
              >
                {{ subItem.label }}
              </div>

              <Button
                v-else-if="subItem.type === 'item'"
                variant="ghost"
                class="w-full justify-start h-auto px-3 py-2.5 gap-2"
                :class="{
                  'text-destructive hover:text-destructive':
                    subItem.variant === 'destructive' && !subItem.disabled,
                  'opacity-50 cursor-not-allowed': subItem.disabled,
                }"
                :disabled="subItem.disabled"
                @click="handleItemClick(subItem)"
              >
                <component
                  v-if="subItem.icon"
                  :is="subItem.icon"
                  :class="[
                    'size-4 shrink-0',
                    {
                      'text-destructive':
                        subItem.variant === 'destructive' && !subItem.disabled,
                    },
                  ]"
                />
                <span>{{ subItem.label }}</span>
              </Button>

              <!-- Nested submenu trigger (supports infinite nesting) -->
              <Button
                v-else-if="subItem.type === 'submenu'"
                variant="ghost"
                class="w-full justify-between h-auto px-3 py-2.5"
                :class="{
                  'opacity-50 cursor-not-allowed': subItem.disabled,
                }"
                :disabled="subItem.disabled"
                @click="openSubmenu(subItem)"
              >
                <span class="flex items-center gap-2">
                  <component
                    v-if="subItem.icon"
                    :is="subItem.icon"
                    class="size-4 shrink-0"
                  />
                  <span>{{ subItem.label }}!</span>
                </span>
                <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </template>
          </div>
        </div>
      </BottomSheet>
    </template>
  </template>

  <!-- Desktop: Dropdown Menu -->
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
        <!-- Header slot -->
        <slot name="header" />

        <template v-for="(item, index) in items" :key="item.id || index">
          <DropdownMenuSeparator v-if="item.type === 'separator'" />

          <!-- Label with optional custom component -->
          <template v-else-if="item.type === 'label'">
            <component
              v-if="item.customComponent"
              :is="markRaw(item.customComponent)"
              v-bind="item.customProps"
            />
            <DropdownMenuLabel v-else class="font-normal">
              {{ item.label }}
            </DropdownMenuLabel>
          </template>

          <!-- Custom component -->
          <component
            v-else-if="item.type === 'custom'"
            :is="markRaw(item.component)"
            v-bind="item.props"
          />

          <!-- Regular item with optional trailing component -->
          <DropdownMenuItem
            v-else-if="item.type === 'item'"
            :disabled="item.disabled"
            :class="[
              item.trailing ? 'flex items-center justify-between' : '',
              {
                'text-destructive focus:text-destructive':
                  item.variant === 'destructive' && !item.disabled,
              },
            ]"
            @click="handleItemClick(item, $event)"
            @select="item.keepOpen ? $event.preventDefault() : undefined"
          >
            <span class="flex items-center gap-2">
              <component
                v-if="item.icon"
                :is="item.icon"
                :class="[
                  'size-4',
                  {
                    'text-destructive':
                      item.variant === 'destructive' && !item.disabled,
                  },
                ]"
              />
              <span>{{ item.label }}</span>
            </span>
            <component
              v-if="item.trailing"
              :is="item.trailing"
              v-bind="item.trailingProps"
              @click.stop
            />
          </DropdownMenuItem>

          <DropdownMenuSub v-else-if="item.type === 'submenu'">
            <DropdownMenuSubTrigger :disabled="item.disabled">
              <component v-if="item.icon" :is="item.icon" class="size-4" />
              <span>{{ item.label }}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <component
                  v-if="item.customComponent"
                  :is="item.customComponent"
                  v-bind="item.customProps"
                />
                <template v-else>
                  <template
                    v-for="(subItem, subIndex) in item.items"
                    :key="subItem.id || subIndex"
                  >
                    <DropdownMenuSeparator
                      v-if="subItem.type === 'separator'"
                    />

                    <!-- Label with optional custom component in submenu -->
                    <template v-else-if="subItem.type === 'label'">
                      <component
                        v-if="subItem.customComponent"
                        :is="markRaw(subItem.customComponent)"
                        v-bind="subItem.customProps"
                      />
                      <DropdownMenuLabel v-else>
                        {{ subItem.label }}
                      </DropdownMenuLabel>
                    </template>

                    <DropdownMenuItem
                      v-else-if="subItem.type === 'item'"
                      :disabled="subItem.disabled"
                      :class="[
                        subItem.trailing ? 'flex items-center justify-between' : '',
                        {
                          'text-destructive focus:text-destructive':
                            subItem.variant === 'destructive' &&
                            !subItem.disabled,
                        },
                      ]"
                      @click="handleItemClick(subItem, $event)"
                      @select="subItem.keepOpen ? $event.preventDefault() : undefined"
                    >
                      <span class="flex items-center gap-2">
                        <component
                          v-if="subItem.icon"
                          :is="subItem.icon"
                          :class="[
                            'size-4',
                            {
                              'text-destructive':
                                subItem.variant === 'destructive' &&
                                !subItem.disabled,
                            },
                          ]"
                        />
                        <span>{{ subItem.label }}</span>
                      </span>
                      <component
                        v-if="subItem.trailing"
                        :is="subItem.trailing"
                        v-bind="subItem.trailingProps"
                        @click.stop
                      />
                    </DropdownMenuItem>
                  </template>
                </template>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </template>

        <!-- Footer slot -->
        <slot name="footer" />
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
