<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
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

const commandService = useCommandService()
const commandStore = useCommandStore()

const open = ref(false)
const query = ref('')

function openHotkeysMenu() {
  open.value = true
}

const hotkeys = computed(() => {
  return commandStore.commands.filter(command => {
    return !!command.hotkey
  })
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

commandService.bindCommandToFunction(
  CommandName.OPEN_HOTKEYS_MENU,
  openHotkeysMenu,
)
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
