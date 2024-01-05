<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMagicKeys } from "@vueuse/core";
import { useRouter, useRoute } from "vue-router";

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
import { ref, watch } from "vue";

const router = useRouter();
const mini = ref(false);

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
        shortcut: "k",
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
    separator: true,
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
    separator: true,
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

const keys = useMagicKeys();

// For each item, add a keyboard shortcut listener
// items.value.forEach((item) => {
//   item.items?.forEach((subitem) => {
//     const shortcut = subitem.shortcut;
//     const route = subitem.route;
//     const key = keys[`Cmd+${shortcut}`];

//     watch(key, (v) => {
//       if (v) {
//         router.push(route);
//       }
//     });
//   });
// });

window.addEventListener("keydown", (e) => {
  if (e.key === "m") {
    mini.value = !mini.value;
  }
});
</script>

<template>
  <div
    :class="
      cn(
        'bg-white max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded',
        $attrs.class ?? ''
      )
    "
  >
    <h2 class="px-4 text-lg font-semibold">
      {{ mini ? "Pa" : "Parchment" }}
    </h2>

    <div v-for="item in items" :key="item.label">
      <Separator v-if="item.separator" />
      <div v-else>
        <div class="flex flex-col gap-1 px-1">
          <Button
            v-for="subitem in item.items"
            :key="subitem.label"
            variant="ghost"
            :class="mini ? 'flex px-2' : 'w-full flex justify-start gap-2 px-3'"
            :to="subitem.route"
          >
            <Icon v-if="mini" :path="subitem.icon"></Icon>

            <div v-else class="flex w-full align-center">
              <Icon class="mr-2" :path="subitem.icon"></Icon>
              <span class="leading-6">{{ subitem.label }}</span>
            </div>

            <Kbd v-if="!mini">
              <span>⌘</span>{{ subitem.shortcut.toUpperCase() }}</Kbd
            >
          </Button>
        </div>
      </div>
    </div>

    <div class="px-3 flex items-center gap-2">
      <Avatar size="xs">
        <AvatarImage
          src="https://github.com/alexwohlbruck.png"
          alt="@alexwohlbruck"
        />
        <AvatarFallback>AW</AvatarFallback>
      </Avatar>
      <div class="flex flex-col" v-if="!mini">
        <span class="text-sm font-semibold">Alex Wohlbruck</span>
        <span class="text-xs text-gray-500">Admin</span>
      </div>
    </div>
  </div>
</template>
