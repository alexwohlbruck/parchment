<script setup lang="ts">
import { computed, ref, markRaw, h, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { appEventBus } from '@/lib/eventBus'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import {
  HelpCircleIcon,
  KeyboardIcon,
  BookOpenIcon,
  CodeIcon,
  MessageSquareQuoteIcon,
  CalendarIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  ChevronRightIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  mini?: boolean
}>()

const { t } = useI18n()
const dropdownOpen = ref(false)
const searchQuery = ref('')

// Custom search input component
const SearchInput = markRaw(
  defineComponent({
    name: 'SearchInput',
    setup() {
      return () =>
        h(Input, {
          modelValue: searchQuery.value,
          'onUpdate:modelValue': (value: string | number) => (searchQuery.value = String(value)),
          placeholder: 'Search for help...',
          class: 'mx-2 my-1',
        })
    },
  }),
)

// External link indicator component
const ExternalIndicator = markRaw(
  defineComponent({
    name: 'ExternalIndicator',
    setup() {
      return () => h(ExternalLinkIcon, { class: 'size-3 text-muted-foreground' })
    },
  }),
)

// Build menu items for ResponsiveDropdown
const menuItems = computed((): MenuItemDefinition[] => {
  const items: MenuItemDefinition[] = [
    {
      type: 'custom',
      id: 'search',
      component: SearchInput,
    },
    {
      type: 'separator',
    },
    {
      type: 'item',
      id: 'shortcuts',
      label: t('palette.commands.openHotkeysMenu.name', 'Shortcuts'),
      icon: KeyboardIcon,
      onSelect: () => {
        appEventBus.emit('hotkeys:open')
      },
    },
    {
      type: 'item',
      id: 'docs',
      label: t('help.docs', 'Docs'),
      icon: BookOpenIcon,
      trailing: ExternalIndicator,
      href: 'https://github.com/alexwohlbruck/parchment/wiki',
    },
    {
      type: 'item',
      id: 'api-docs',
      label: t('help.apiDocs', 'API Docs'),
      icon: CodeIcon,
      trailing: ExternalIndicator,
      href: 'https://github.com/alexwohlbruck/parchment/wiki/API',
    },
    {
      type: 'item',
      id: 'feedback',
      label: t('feedback.title'),
      icon: MessageSquareQuoteIcon,
      trailing: ExternalIndicator,
      href: 'https://github.com/alexwohlbruck/parchment/issues',
    },
    {
      type: 'separator',
    },
    {
      type: 'label',
      id: 'whats-new-label',
      label: t('help.whatsNew', "What's new"),
    },
    {
      type: 'item',
      id: 'pulse',
      label: 'Introducing Pulse — your personalized feed fo...',
      icon: CircleDotIcon,
      onSelect: () => {
        // TODO: Navigate to pulse feature or show details
      },
    },
    {
      type: 'item',
      id: 'new-search',
      label: 'New search',
      icon: CircleDotIcon,
      onSelect: () => {
        // TODO: Navigate to search feature or show details
      },
    },
    {
      type: 'item',
      id: 'changelog',
      label: t('help.fullChangelog', 'Full changelog'),
      icon: CalendarIcon,
      trailing: ExternalIndicator,
      href: 'https://github.com/alexwohlbruck/parchment/releases',
    },
  ]
  return items
})
</script>

<template>
  <ResponsiveDropdown
    v-model:open="dropdownOpen"
    :items="menuItems"
    :side="mini ? 'right' : 'top'"
    :align="mini ? 'end' : 'start'"
    content-class="w-64"
  >
    <template #trigger="{ open }">
      <Button
        variant="ghost"
        :class="
          cn(
            'w-full h-auto px-3 py-2 rounded-lg flex flex-row justify-center gap-2 hover:bg-foreground/5',
          )
        "
        @click.stop="open"
      >
        <HelpCircleIcon class="size-5" />
        <span v-if="!mini" class="flex-1 text-left text-sm">
          {{ t('help.title', 'Help') }}
        </span>
        <ChevronRightIcon
          v-if="!mini"
          class="size-4 text-muted-foreground self-center transform rotate-90"
        />
      </Button>
    </template>
  </ResponsiveDropdown>
</template>
