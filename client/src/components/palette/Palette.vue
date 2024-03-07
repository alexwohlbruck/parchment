<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCommandService } from '../../services/command/command.service'
import { useCommandStore } from '../../stores/command.store'
import { type Command as TCommand } from '@/types/command.types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { SearchIcon, MapPinIcon } from 'lucide-vue-next'
import Kbd from '@/components/ui/kbd/Kbd.vue'

const commandStore = useCommandStore()
const {
  bindCommandToFunction,
  activeCommand,
  activeArgument,
  reset: resetCommand,
  executeCommand,
} = useCommandService()

const query = ref('')
const commandOpen = ref(true)
const showResults = ref(false)

const commandPalette = ref<InstanceType<typeof Command> | null>(null)
const input = ref<InstanceType<typeof CommandInput> | null>(null)

bindCommandToFunction('focusSearch', focusSearch)

const filteredCommands = computed(() => {
  // Don't include the focusSearch command in the results, we are already looking at the search palette
  return commandStore.commands.filter(command => command.id != 'focusSearch')
})

function openPalette() {
  commandOpen.value = true
  focusSearch()
}

function closePalette() {
  clearInput()
  blurSearch()
  showResults.value = false
}

function focusSearch() {
  input.value?.inputElement?.focus()
}

function blurSearch() {
  input.value?.inputElement?.blur()
}

function clearInput() {
  query.value = ''
}

function inputFocused(event: FocusEvent) {
  showResults.value = true
}

function inputBlurred(event: FocusEvent) {
  // Check if we clicked inside the palette. If not, hide the results
  const relatedTarget = event.relatedTarget as HTMLElement | null
  const paletteContainer = commandPalette.value?.$el
    ?.parentElement as HTMLElement | null
  if (relatedTarget && paletteContainer?.contains(relatedTarget)) {
    event.preventDefault()
  } else {
    showResults.value = false
    resetCommand()
  }
}

function onBackspace() {
  if (query.value === '') {
    resetCommand()
  }
}

function onCommandSelected(command: TCommand) {
  executeCommand(command)
  if (command.arguments) {
    clearInput()
  } else {
    closePalette()
  }
}

function onArgumentSelected(value: string) {
  if (!activeCommand.value) return
  executeCommand(activeCommand.value, value)
}

// Close palette when all args are submitted, command executed
watch(activeCommand, (newVal, prevVal) => {
  if (newVal === null && prevVal) {
    closePalette()
  }
})

// If a command is executed that needs arguments, open the palette
watch(activeArgument, (newVal, prevVal) => {
  if (newVal) {
    openPalette()
  }
})

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
</script>

<template>
  <Command
    class="shadow-md"
    ref="commandPalette"
    v-model:searchTerm="query"
    :open="commandOpen"
  >
    <CommandInput
      ref="input"
      :placeholder="activeCommand ? 'Search...' : 'Search or type command...'"
      @focus="inputFocused($event)"
      @blur="inputBlurred($event)"
      @keydown.backspace="onBackspace()"
    >
      <template v-slot:prefix>
        <div
          v-if="activeCommand"
          class="select-none whitespace-nowrap rounded-md bg-primary px-1.5 py-1 font-sans text-xs text-primary-foreground"
        >
          {{ activeCommand.name }}
        </div>
        <SearchIcon v-else class="h-4 w-4 shrink-0 opacity-50" />
      </template>
      <template v-slot:postfix>
        <Kbd v-if="!activeCommand" commandId="focusSearch"></Kbd>
      </template>
    </CommandInput>

    <template v-if="showResults">
      <!-- Top-level commands list -->
      <CommandList v-if="!activeArgument">
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

        <CommandGroup heading="Commands">
          <CommandItem
            v-for="command in filteredCommands"
            :key="command.id"
            :value="command.id"
            class="flex gap-2"
            @select="onCommandSelected(command)"
          >
            <component :is="command.icon" class="size-5" />
            <div class="flex-1 flex flex-col">
              <span class="font-semibold">{{ command.name }}</span>
              <span class="text-sm text-gray-500" v-if="command.description">{{
                command.description
              }}</span>
            </div>
            <Kbd
              v-if="command.hotkey"
              :hotkey="command.hotkey"
              class="ml-2"
            ></Kbd>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <!-- Command selected, display arguments -->
      <CommandList v-if="activeArgument">
        <CommandGroup :heading="activeArgument.name">
          <CommandItem
            v-for="argumentOption in activeArgument.getItems()"
            :key="argumentOption.value"
            :value="argumentOption.value"
            class="flex gap-2"
            @select="onArgumentSelected(argumentOption.value)"
          >
            <!-- <component :is="command.icon" class="size-5" /> -->
            <div class="flex-1 flex flex-col">
              <span class="font-semibold">{{ argumentOption.name }}</span>
              <span
                class="text-sm text-gray-500"
                v-if="argumentOption.description"
              >
                {{ argumentOption.description }}
              </span>
            </div>
            <!-- <Kbd
              v-if="command.hotkey"
              :hotkey="command.hotkey"
              class="ml-2"
            ></Kbd> -->
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </template>
  </Command>
</template>
