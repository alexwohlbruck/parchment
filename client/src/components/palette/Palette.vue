<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommandService } from '../../services/command/command.service'
import { useCommandStore } from '../../stores/command.store'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { MapPinIcon } from 'lucide-vue-next'
import Kbd from '@/components/ui/kbd/Kbd.vue'
import { type Command as TCommand } from '../../types/command.types'

const commandService = useCommandService()
const commandStore = useCommandStore()

const query = ref('')
const showResults = ref(false)
const commandPalette = ref<InstanceType<typeof Command> | null>(null)
const input = ref<InstanceType<typeof CommandInput> | null>(null)

function focusSearch() {
  input.value?.inputElement?.focus()
}

function blurSearch() {
  input.value?.inputElement?.blur()
}

commandService.bindCommandToFunction('focusSearch', focusSearch)

// Some example place results for the map search results. Schema is tentative, subject to change
const places = [
  {
    name: 'Viva Chicken',
    address: '1617 Elizabeth Ave, Charlotte, NC 28204',
    type: 'restaurant',
    distance: '0.2 mi',
  },
  {
    name: "The Workman's Friend",
    address: '1531 Central Ave, Charlotte, NC 28205',
    type: 'bar',
    distance: '0.3 mi',
  },
  {
    name: 'The Diamond',
    address: '1901 Commonwealth Ave, Charlotte, NC 28205',
    type: 'bar',
    distance: '0.4 mi',
  },
  {
    name: 'Sabor Latin Street Grill',
    address: '415 Hawthorne Ln, Charlotte, NC 28204',
    type: 'restaurant',
    distance: '0.5 mi',
  },
  {
    name: 'The Pizza Peel Plaza Midwood',
    address: '1600 Central Ave, Charlotte, NC 28205',
    type: 'restaurant',
    distance: '0.6 mi',
  },
]

const filteredCommands = computed(() => {
  // Don't include the focusSearch command in the results, we are already looking at the search palette
  return commandStore.commands.filter(command => command.id != 'focusSearch')
})

function executeCommand(command: TCommand) {
  if (command.action) command.action()
  query.value = ''
  blurSearch()
}

function inputFocused(event: FocusEvent) {
  console.log('inputFocused')
  showResults.value = true
}

function inputBlurred(event: FocusEvent) {
  console.log('inputBlurred')
  // Check if we clicked inside the palette. If not, hide the results
  const relatedTarget = event.relatedTarget as HTMLElement | null
  const paletteContainer = commandPalette.value?.$el
    ?.parentElement as HTMLElement | null
  if (relatedTarget && paletteContainer?.contains(relatedTarget)) {
    event.preventDefault()
  } else {
    showResults.value = false
  }
}
</script>

<template>
  <Command class="shadow-md" ref="commandPalette">
    <CommandInput
      ref="input"
      placeholder="Search or type command..."
      @focus="inputFocused($event)"
      @blur="inputBlurred($event)"
    >
      <Kbd commandId="focusSearch" class="ml-2"></Kbd>
    </CommandInput>
    <CommandList v-show="showResults">
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Places">
        <CommandItem
          v-for="place in places"
          :key="place.name"
          :value="place.name"
          class="flex gap-2"
        >
          <MapPinIcon class="size-5" />
          <div class="flex-1 flex flex-col">
            <span class="font-semibold">{{ place.name }}</span>
            <span class="text-sm text-gray-500">{{ place.address }}</span>
          </div>
          <span class="text-sm text-gray-500">{{ place.distance }}</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="App navigation">
        <CommandItem value="places"> Places </CommandItem>
        <CommandItem value="timeline"> Timeline </CommandItem>
        <CommandItem value="settings"> Settings </CommandItem>
      </CommandGroup>
      <CommandGroup heading="Commands">
        <CommandItem
          v-for="command in filteredCommands"
          :key="command.id"
          :value="command.id"
          class="flex gap-2"
          @select="executeCommand(command)"
        >
          <component :is="command.icon" class="size-5" />
          <div class="flex-1 flex flex-col">
            <span class="font-semibold">{{ command.name }}</span>
            <span class="text-sm text-gray-500">{{ command.description }}</span>
          </div>
          <Kbd
            v-if="command.hotkey"
            :hotkey="command.hotkey"
            class="ml-2"
          ></Kbd>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
