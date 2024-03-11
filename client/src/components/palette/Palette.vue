<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCommandService } from '@/services/command.service'
import { useCommandStore } from '@/stores/command.store'
import { ArgumentType, type Command as TCommand } from '@/types/command.types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { SearchIcon, MapPinIcon, TerminalIcon } from 'lucide-vue-next'
import Kbd from '@/components/ui/kbd/Kbd.vue'

const commandStore = useCommandStore()
const {
  bindCommandToFunction,
  activeCommand,
  activeArgument,
  argumentsList,
  reset: resetCommand,
  executeCommand,
} = useCommandService()

const query = ref('')
const commandOpen = ref(true)
const showResults = ref(false)

const commandPalette = ref<InstanceType<typeof Command> | null>(null)
const input = ref<InstanceType<typeof CommandInput> | null>(null)

bindCommandToFunction('openPalette', focusInput)

const filteredCommands = computed(() => {
  // Don't include the openPalette command in the results, we are already looking at the search palette
  return commandStore.commands.filter(command => command.id != 'openPalette')
})

function openPalette() {
  commandOpen.value = true
  focusInput()
}

function closePalette() {
  clearInput()
  blurInput()
  showResults.value = false
}

function focusInput() {
  input.value?.inputElement?.focus()
}

function blurInput() {
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
    openPalette()
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

function onArgumentSelected(value: ArgumentType) {
  if (activeCommand.value) {
    executeCommand(activeCommand.value, value)
  }

  // If we have no more arguments left, close the palette
  // TODO: This logic is done already in command service, reuse it
  const totalArgs = activeCommand.value?.arguments?.length || 0
  const argsLeft = argumentsList.value.length
  if (totalArgs - argsLeft === 0) {
    closePalette()
  }
}

// If a command is executed that needs arguments, open the palette
watch(activeArgument, (newVal, prevVal) => {
  if (newVal) {
    openPalette()
  }
})

const placeholder = computed(() => {
  return showResults.value
    ? activeCommand.value
      ? 'Search...'
      : 'Run command...'
    : 'Search or run command...'
})

const icon = computed(() => {
  return showResults.value
    ? activeCommand.value?.icon ?? TerminalIcon
    : SearchIcon
})
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
      :placeholder="placeholder"
      @focus="inputFocused($event)"
      @blur="inputBlurred($event)"
      @keydown.backspace="onBackspace()"
    >
      <template v-slot:prefix>
        <component :is="icon" class="h-4 w-4 shrink-0 opacity-50" />

        <template v-if="activeCommand">
          <div
            class="select-none whitespace-nowrap rounded-md bg-primary px-1.5 py-1 font-sans text-xs text-primary-foreground"
          >
            {{ activeCommand.name }}
          </div>
        </template>
      </template>
      <template v-slot:postfix v-if="!showResults">
        <Kbd commandId="openPalette"></Kbd>
        <Kbd commandId="search"></Kbd>
      </template>
    </CommandInput>

    <template v-if="showResults">
      <!-- Top-level commands list -->
      <CommandList v-if="!activeArgument">
        <CommandEmpty>No results found.</CommandEmpty>

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
              <span class="font-semibold">
                {{ command.name
                }}<template v-if="command.arguments">...</template>
              </span>
              <span class="text-sm text-gray-500" v-if="command.description">
                {{ command.description }}
              </span>
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
