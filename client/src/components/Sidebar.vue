<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import Kbd from "@/components/ui/kbd/Kbd.vue";
import Icon from "@/components/ui/icon/Icon.vue";
import {
  mdiMapOutline,
  mdiMagnify,
  mdiDirections,
  mdiBookmarkOutline,
  mdiHistory,
  mdiMapMarkerMultipleOutline,
  mdiCloudOffOutline,
  mdiAccountSupervisorCircleOutline,
  mdiCogOutline,
} from "@mdi/js";
import { ref } from "vue";

const items = ref([
  {
    separator: true,
  },
  {
    label: "Navigate",
    items: [
      {
        label: "Map",
        icon: mdiMapOutline,
        shortcut: "m",
        route: "/map",
      },
      {
        label: "Search",
        icon: mdiMagnify,
        shortcut: "/",
        route: "/map/search",
      },
      {
        label: "Directions",
        icon: mdiDirections,
        shortcut: "d",
        route: "/map/directions",
      },
    ],
  },
  {
    label: "Explore",
    items: [
      {
        label: "Places",
        icon: mdiBookmarkOutline,
        shortcut: "p",
        route: "/places",
      },
      {
        label: "Timeline",
        icon: mdiHistory,
        shortcut: "t",
        route: "/timeline",
      },
      {
        label: "Offline maps",
        shortcut: "o",
        icon: mdiCloudOffOutline,
        route: "/offline",
      },
      {
        label: "Custom maps",
        shortcut: "c",
        icon: mdiMapMarkerMultipleOutline,
        route: "/custom",
      },
      {
        label: "People",
        shortcut: "l",
        icon: mdiAccountSupervisorCircleOutline,
        route: "/people",
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        label: "Settings",
        icon: mdiCogOutline,
        shortcut: "s",
        route: "/settings",
      },
    ],
  },
  {
    separator: true,
  },
]);
</script>

<template>
  <div :class="cn('pb-12 shadow-md', $attrs.class ?? '')">
    <div class="space-y-4 py-4">
      <h2 class="mb-2 px-4 text-lg font-semibold">Parchment</h2>
      <div v-for="item in items" :key="item.label">
        <Separator v-if="item.separator" />
        <div v-else>
          <div class="px-3 py-2">
            <h2 class="mb-2 px-4 text-lg font-semibold">{{ item.label }}</h2>
            <div class="space-y-1">
              <Button
                v-for="subitem in item.items"
                :key="subitem.label"
                variant="ghost"
                class="w-full justify-start"
              >
                <Icon class="mr-2" :path="subitem.icon"></Icon>
                {{ subitem.label }}
                <Kbd> <span>⌘</span>{{ subitem.shortcut }}</Kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
