<script setup lang="ts">
import { useMagicKeys } from "@vueuse/core";
import { ref, watch } from "vue";

import Sidebar from "./components/Sidebar.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  <div class="flex">
    <Sidebar></Sidebar>
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

  <AlertDialog>
    <AlertDialogTrigger>Open</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone. This will permanently delete your
          account and remove your data from our servers.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Continue</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
