<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useCommandService } from '../services/command/command.service'
import { useCommandStore } from '../stores/command.store'
import Span from '@/components/ui/typography/Span.vue'
import Kbd from '@/components/ui/kbd/Kbd.vue'

const commandService = useCommandService()
const commandStore = useCommandStore()

const open = ref(true)
const query = ref('')

function openHotkeysMenu() {
  open.value = true
}

const filteredCommands = computed(() => {
  return commandStore.commands.filter(command => {
    const hasHotkey = !!command.hotkey
    const queryMatchesName = command.name
      .toLowerCase()
      .includes(query.value.toLowerCase())
    const queryMatchesDescription = command.description
      ? command.description.toLowerCase().includes(query.value.toLowerCase())
      : true
    return hasHotkey && (queryMatchesName || queryMatchesDescription)
  })
})

watch(open, value => {
  if (!value) query.value = ''
})

commandService.bindCommandToFunction('openHotkeysMenu', openHotkeysMenu)
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

        <div v-for="command in filteredCommands" :key="command.id">
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
