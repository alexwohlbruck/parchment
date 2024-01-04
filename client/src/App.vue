<script setup lang="ts">
import { useMagicKeys } from "@vueuse/core";
import { ref, watch } from "vue";

import Sidebar from "./components/Sidebar.vue";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const open = ref(false);

const keys = useMagicKeys();
const CmdK = keys["Cmd+K"];

function handleOpenChange() {
  open.value = !open.value;
}

watch(CmdK, (v) => {
  if (v) handleOpenChange();
});
</script>

<template>
  <div class="flex h-dvh gap-2">
    <div class="flex flex-col justify-center">
      <Sidebar class="z-20" />
    </div>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>

  <CommandDialog :open="open" :on-open-change="handleOpenChange">
    <CommandInput placeholder="Type a command or search..." />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Suggestions">
        <CommandItem value="calendar"> Calendar </CommandItem>
        <CommandItem value="search-emoji"> Search Emoji </CommandItem>
        <CommandItem value="calculator"> Calculator </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Settings">
        <CommandItem value="profile"> Profile </CommandItem>
        <CommandItem value="billing"> Billing </CommandItem>
        <CommandItem value="settings"> Settings </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
