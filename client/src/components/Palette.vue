<script setup lang="ts">
import { useMagicKeys } from "@vueuse/core";
import { ref, watch } from "vue";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

import Icon from "./ui/icon/Icon.vue";
import { mdiMapMarkerOutline } from "@mdi/js";

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

// const open = ref(false);

// const keys = useMagicKeys();
// const CmdK = keys["Cmd+K"];

function handleOpenChange() {
  // TODO:
}

// watch(CmdK, (v) => {
//   if (v) handleOpenChange();
// });

// Some example place results for the map search results. Schema is tentative, subject to change
const places = [
  {
    name: "Viva Chicken",
    address: "1617 Elizabeth Ave, Charlotte, NC 28204",
    type: "restaurant",
    distance: "0.2 mi",
  },
  {
    name: "The Workman's Friend",
    address: "1531 Central Ave, Charlotte, NC 28205",
    type: "bar",
    distance: "0.3 mi",
  },
  {
    name: "The Diamond",
    address: "1901 Commonwealth Ave, Charlotte, NC 28205",
    type: "bar",
    distance: "0.4 mi",
  },
  {
    name: "Sabor Latin Street Grill",
    address: "415 Hawthorne Ln, Charlotte, NC 28204",
    type: "restaurant",
    distance: "0.5 mi",
  },
  {
    name: "The Pizza Peel Plaza Midwood",
    address: "1600 Central Ave, Charlotte, NC 28205",
    type: "restaurant",
    distance: "0.6 mi",
  },
];
</script>

<template>
  <CommandDialog :open="open" :on-open-change="handleOpenChange">
    <CommandInput placeholder="Search or type command..." />
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <CommandGroup heading="Places">
        <!-- <CommandItem value="calendar"> Calendar </CommandItem> -->
        <CommandItem
          v-for="place in places"
          :key="place.name"
          :value="place.name"
          class="flex gap-2"
        >
          <Icon :path="mdiMapMarkerOutline" />
          <div class="flex-1 flex flex-col">
            <span class="font-semibold">{{ place.name }}</span>
            <span class="text-sm text-gray-500">{{ place.address }}</span>
          </div>
          <span class="text-sm text-gray-500">{{ place.distance }}</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Navigation">
        <CommandItem value="places"> Places </CommandItem>
        <CommandItem value="timeline"> Timeline </CommandItem>
        <CommandItem value="settings"> Settings </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
