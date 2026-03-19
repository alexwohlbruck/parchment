<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import fuzzysort from 'fuzzysort'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCommandService } from '@/services/command.service'
import { CommandName, useCommandStore } from '@/stores/command.store'
import Span from '@/components/ui/typography/Span.vue'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import { useHotkeyStore } from '@/stores/hotkey.store'
import type { Command } from '@/types/command.types'
import { useHotkeys } from '@/composables/useHotkeys'
import { appEventBus } from '@/lib/eventBus'

const commandService = useCommandService()
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

// Combine command hotkeys and ephemeral hotkeys
const hotkeys = computed(() => {
  const commandHotkeys: Array<Command & { id: string }> = commandStore.commands
    .filter(command => !!command.hotkey)
    .map(command => ({
      ...command,
      id: command.id,
    }))

  const ephemeralHotkeys = hotkeyStore.getAllEphemeralHotkeys().map(hotkey => ({
    id: hotkey.id,
    name: hotkey.name,
    description: hotkey.description,
    hotkey: hotkey.hotkey,
  }))

  return [...commandHotkeys, ...ephemeralHotkeys]
})

const searchResults = computed(() => {
  if (!query.value) return hotkeys.value
  return fuzzysort
    .go(query.value, hotkeys.value, {
      keys: ['name', 'description', 'keywords'],
    })
    .map(result => result.obj)
})

watch(open, value => {
  if (!value) query.value = ''
})

useHotkeys([
  {
    id: 'open-hotkeys-menu',
    key: ['h'],
    name: 'Open hotkeys menu',
    description: 'Open the hotkeys menu',
    handler: openHotkeysMenu,
  },
])
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          View all the keyboard shortcuts available in the app.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <Input v-model="query" placeholder="Search..." />

        <div v-for="command in searchResults" :key="command.id">
          <template v-if="command.hotkey">
            <div class="flex justify-between items-center">
              <div class="flex flex-col">
                <Span class="font-medium text-sm">{{ command.name }}</Span>
                <Span class="text-sm">{{ command.description }}</Span>
              </div>

              <Kbd :hotkey="command.hotkey" />
            </div>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
