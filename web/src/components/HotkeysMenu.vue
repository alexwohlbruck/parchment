<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import fuzzysort from 'fuzzysort'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCommandStore } from '@/stores/command.store'
import Span from '@/components/ui/typography/Span.vue'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import { useHotkeyStore } from '@/stores/hotkey.store'
import type { Command, CommandCategory, Hotkey } from '@/types/command.types'
import { groupByCategory } from '@/lib/command/group-by-category'
import { groupByContext } from '@/lib/command/group-by-context'
import { appEventBus } from '@/lib/event-bus'

type HotkeyEntry = {
  id: string
  context?: string
  name: string
  description?: string
  keywords?: string
  hotkey: Hotkey
  category: CommandCategory
}

const { t } = useI18n()
const commandStore = useCommandStore()
const hotkeyStore = useHotkeyStore()

const open = ref(false)
const query = ref('')

function openHotkeysMenu() {
  open.value = true
}

onMounted(() => {
  appEventBus.on('hotkeys:open', openHotkeysMenu)
})

onUnmounted(() => {
  appEventBus.off('hotkeys:open', openHotkeysMenu)
})

function toEntries(commands: Command[]): HotkeyEntry[] {
  return commands.flatMap(command =>
    command.hotkey
      ? [
          {
            id: command.id,
            context: command.context,
            name: command.name,
            description: command.description,
            keywords: command.keywords,
            hotkey: command.hotkey,
            category: command.category ?? 'general',
          },
        ]
      : [],
  )
}

const hotkeys = computed<HotkeyEntry[]>(() => [
  ...toEntries(commandStore.contextualCommands),
  ...toEntries(commandStore.commands),
  ...hotkeyStore.ephemeralHotkeysList,
])

const searchResults = computed(() => {
  if (!query.value) return hotkeys.value
  return fuzzysort
    .go(query.value, hotkeys.value, {
      keys: ['name', 'description', 'keywords'],
    })
    .map(result => result.obj)
})

const groups = computed(() => [
  ...groupByContext(searchResults.value).map(group => ({
    key: `context:${group.context}`,
    heading: group.context,
    items: group.items,
  })),
  ...groupByCategory(
    searchResults.value.filter(entry => !entry.context),
    !!query.value,
  ).map(group => ({
    key: group.category,
    heading: t(`palette.categories.${group.category}`),
    items: group.items,
  })),
])

watch(open, value => {
  if (!value) query.value = ''
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{
          t('palette.commands.openHotkeysMenu.name')
        }}</DialogTitle>
        <DialogDescription>
          {{ t('palette.commands.openHotkeysMenu.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-6">
        <Input v-model="query" :placeholder="t('hotkeys.search')" />

        <section
          v-for="group in groups"
          :key="group.key"
          class="flex flex-col gap-3"
        >
          <Span class="text-xs font-medium text-muted-foreground">
            {{ group.heading }}
          </Span>

          <div
            v-for="hotkey in group.items"
            :key="hotkey.id"
            class="flex justify-between items-center gap-4"
          >
            <div class="flex flex-col">
              <Span class="font-medium text-sm">{{ hotkey.name }}</Span>
              <Span class="text-sm text-muted-foreground">
                {{ hotkey.description }}
              </Span>
            </div>

            <Kbd :hotkey="hotkey.hotkey" />
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
