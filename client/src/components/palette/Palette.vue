<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import fuzzysort from 'fuzzysort'
import { onClickOutside, useMagicKeys } from '@vueuse/core'
import { useCommandService } from '@/services/command.service'
import { useCommandStore } from '@/stores/command.store'
import {
  ArgumentType,
  CommandArgumentOption,
  PaletteItem,
  type Command as TCommand,
} from '@/types/command.types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { SearchIcon, MapPinIcon, TerminalIcon, XIcon } from 'lucide-vue-next'
import Kbd from '@/components/ui/kbd/Kbd.vue'

const { t } = useI18n()
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

const container = ref()
const commandPalette = ref<InstanceType<typeof Command>>()
const input = ref<InstanceType<typeof CommandInput>>()
const { escape } = useMagicKeys()

bindCommandToFunction('openPalette', focusInput)

const filteredCommands = computed(() => {
  // Don't include the openPalette command in the results, we are already looking at the search palette
  return commandStore.commands.filter(command => command.id != 'openPalette')
})

function openPalette(withSearch = false) {
  commandOpen.value = true
  showResults.value = true
  focusInput()

  if (withSearch) {
    const searchCommand = commandStore.commands.find(
      command => command.id === 'search',
    )
    executeCommand(searchCommand!)
  }
}

function closePalette() {
  clearInput()
  blurInput()
  showResults.value = false
}

function resetOrClose() {
  if (activeArgument.value) {
    resetCommand()
  } else if (showResults.value) {
    closePalette()
  }
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
  if (!showResults.value) {
    openPalette(true)
  }
}

onClickOutside(container, event => {
  console.log('clicked outside', event)
  showResults.value = false
  resetCommand()
})

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

watch(escape, value => {
  if (value) {
    resetCommand()
    closePalette()
  }
})

const placeholder = computed(() => {
  return showResults.value
    ? activeCommand.value
      ? t('palette.placeholder.argument')
      : t('palette.placeholder.command')
    : t('palette.placeholder.default')
})

const icon = computed(() => {
  return showResults.value
    ? activeCommand.value?.icon ?? TerminalIcon
    : SearchIcon
})

function filterFunction(val: PaletteItem[], term: string): PaletteItem[] {
  if (!term) return val

  return fuzzysort
    .go(term, val, {
      keys: ['name', 'description', 'keywords'],
    })
    .map(result => result.obj)
}
</script>

<template>
  <div ref="container">
    <Command
      class="shadow-md"
      ref="commandPalette"
      v-model:searchTerm="query"
      :open="commandOpen"
      :filter-function="filterFunction as any"
    >
      <CommandInput
        ref="input"
        :placeholder="placeholder"
        @focus="inputFocused($event)"
        @keydown.backspace="onBackspace()"
      >
        <template v-slot:prefix>
          <component :is="icon" class="size-4 shrink-0 opacity-50" />

          <template v-if="activeCommand">
            <div
              class="select-none whitespace-nowrap rounded-md bg-primary px-1.5 py-1 font-sans text-xs text-primary-foreground"
            >
              {{ activeCommand.name }}
            </div>
          </template>
        </template>
        <template v-slot:postfix>
          <template v-if="!showResults">
            <div class="flex gap-1">
              <Kbd commandId="search"></Kbd>
              <Kbd commandId="openPalette"></Kbd>
            </div>
          </template>
          <span class="w-4" v-else>
            <XIcon
              class="size-4 cursor-pointer opacity-50 hover:opacity-100"
              @click="resetOrClose()"
            />
          </span>
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
              :value="command"
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
              :value="argumentOption"
              class="flex gap-2"
              @select="onArgumentSelected(argumentOption.value)"
            >
              <component
                v-if="activeArgument.customItemComponent"
                :is="activeArgument.customItemComponent"
                v-bind:argumentOption="argumentOption"
              />

              <template v-else>
                <component
                  v-if="argumentOption.icon"
                  :is="argumentOption.icon"
                  class="size-5"
                />
                <div class="flex-1 flex flex-col">
                  <span class="font-semibold">{{ argumentOption.name }}</span>
                  <span
                    class="text-sm text-gray-500"
                    v-if="argumentOption.description"
                  >
                    {{ argumentOption.description }}
                  </span>
                </div>
              </template>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </template>
    </Command>
  </div>
</template>
