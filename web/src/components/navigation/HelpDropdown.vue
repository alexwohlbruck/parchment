<script setup lang="ts">
import { computed, ref, markRaw, h, defineComponent, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { useExternalLink } from '@/composables/useExternalLink'
import { CommandName } from '@/stores/command.store'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import ResponsiveDropdown, {
  type MenuItemDefinition,
} from '@/components/responsive/ResponsiveDropdown.vue'
import {
  CircleHelpIcon,
  KeyboardIcon,
  BookOpenIcon,
  CodeXmlIcon,
  MessageSquareQuoteIcon,
  ExternalLinkIcon,
  SparklesIcon,
  CalendarIcon,
} from 'lucide-vue-next'
import HotkeysMenu from '@/components/HotkeysMenu.vue'

const props = defineProps<{
  mini?: boolean
}>()

const { t } = useI18n()
const { openExternalLink } = useExternalLink()

const dropdownOpen = ref(false)
const hotkeysMenuOpen = ref(false)
const searchQuery = ref('')

// Search input component
const SearchInput = markRaw(defineComponent({
  name: 'SearchInput',
  setup() {
    return () =>
      h('div', { class: 'px-2 pt-1 pb-2' }, [
        h(Input, {
          'modelValue': searchQuery.value,
          'onUpdate:modelValue': (val: string | number) => { searchQuery.value = String(val) },
          'placeholder': t('help.search.placeholder'),
          'class': 'h-9',
        })
      ])
  },
})) as Component

// Keyboard shortcut component for Shortcuts item
const ShortcutsKbd = markRaw(defineComponent({
  name: 'ShortcutsKbd',
  setup() {
    return () =>
      h('span', { class: 'flex items-center gap-0.5 text-xs text-muted-foreground' }, [
        h('span', { class: 'px-1.5 py-0.5 rounded border border-border bg-muted font-mono' }, '⌘'),
        h('span', { class: 'px-1.5 py-0.5 rounded border border-border bg-muted font-mono' }, '/'),
      ])
  },
})) as Component

// Build menu items for ResponsiveDropdown
const menuItems = computed((): MenuItemDefinition[] => {
  const items: MenuItemDefinition[] = [
    {
      type: 'custom',
      component: SearchInput,
    },
    {
      type: 'separator',
    },
    {
      type: 'item',
      id: 'shortcuts',
      label: t('help.shortcuts.title'),
      icon: KeyboardIcon,
      trailing: ShortcutsKbd,
      onSelect: () => {
        hotkeysMenuOpen.value = true
      },
    },
    {
      type: 'separator',
    },
    {
      type: 'item',
      id: 'docs',
      label: t('help.docs.title'),
      icon: BookOpenIcon,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-3 text-muted-foreground' },
      href: 'https://docs.parchment.app',
    },
    {
      type: 'item',
      id: 'api-docs',
      label: t('help.apiDocs.title'),
      icon: CodeXmlIcon,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-3 text-muted-foreground' },
      href: 'https://docs.parchment.app/api',
    },
    {
      type: 'item',
      id: 'feedback',
      label: t('help.feedback.title'),
      icon: MessageSquareQuoteIcon,
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-3 text-muted-foreground' },
      href: 'https://github.com/alexwohlbruck/parchment/issues',
    },
    {
      type: 'separator',
    },
    {
      type: 'label',
      id: 'whats-new-label',
      label: t('help.whatsNew.title'),
    },
    {
      type: 'item',
      id: 'changelog-1',
      label: t('help.whatsNew.items.pulse'),
      icon: SparklesIcon,
      onSelect: () => {
        // In future, this could open a dialog with details
      },
    },
    {
      type: 'item',
      id: 'changelog-2',
      label: t('help.whatsNew.items.newSearch'),
      icon: CalendarIcon,
      onSelect: () => {
        // In future, this could open a dialog with details
      },
    },
    {
      type: 'item',
      id: 'full-changelog',
      label: t('help.whatsNew.fullChangelog'),
      trailing: ExternalLinkIcon,
      trailingProps: { class: 'size-3 text-muted-foreground' },
      href: 'https://github.com/alexwohlbruck/parchment/releases',
    },
  ]
  return items
})
</script>

<template>
  <TooltipProvider :disabled="!mini">
    <Tooltip>
      <ResponsiveDropdown
        v-model:open="dropdownOpen"
        :items="menuItems"
        :side="mini ? 'right' : 'top'"
        :align="mini ? 'end' : 'start'"
        content-class="w-64"
      >
        <template #trigger="{ open }">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              :class="
                cn(
                  'w-full flex px-3 justify-center gap-3 hover:bg-primary/5 hover:text-primary',
                )
              "
              @click.stop="open"
            >
              <CircleHelpIcon class="size-5" />
              <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                <div class="flex-1 text-left">
                  {{ t('help.title') }}
                </div>
              </div>
            </Button>
          </TooltipTrigger>
        </template>
      </ResponsiveDropdown>

      <TooltipContent side="right" v-if="mini">
        <p>{{ t('help.title') }}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>

  <HotkeysMenu v-model:open="hotkeysMenuOpen" />
</template>
