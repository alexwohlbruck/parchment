<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import LayersSelector from "@/components/LayersSelector.vue";
// import { useMagicKeys } from "@vueuse/core";
import { useRouter } from "vue-router";

import Kbd from "@/components/ui/kbd/Kbd.vue";

import {
  MapIcon,
  MilestoneIcon,
  BookMarkedIcon,
  HistoryIcon,
  CloudOffIcon,
  MapPinnedIcon,
  UsersRoundIcon,
  SettingsIcon,
  Layers3Icon,
} from "lucide-vue-next";

import { ref } from "vue";

const router = useRouter();
const mini = ref(true);

const items = ref([
  {
    separator: true,
  },
  {
    items: [
      {
        label: "Map",
        icon: MapIcon,
        shortcut: "m",
        to: "/",
      },
      {
        label: "Directions",
        icon: MilestoneIcon,
        shortcut: "d",
        to: "/directions",
      },
    ],
  },
  {
    separator: true,
  },
  {
    items: [
      {
        label: "Places",
        icon: BookMarkedIcon,
        shortcut: "p",
        to: "/places",
      },
      {
        label: "Timeline",
        icon: HistoryIcon,
        shortcut: "t",
        to: "/timeline",
      },
      {
        label: "Offline maps",
        shortcut: "o",
        icon: CloudOffIcon,
        to: "/offline",
      },
      {
        label: "Custom maps",
        shortcut: "c",
        icon: MapPinnedIcon,
        to: "/custom",
      },
      {
        label: "People",
        shortcut: "l",
        icon: UsersRoundIcon,
        to: "/people",
      },
    ],
  },
  {
    separator: true,
  },
  {
    items: [
      {
        label: "Settings",
        icon: SettingsIcon,
        shortcut: "s",
        to: "/settings",
      },
      {
        label: "Layers",
        icon: Layers3Icon,
        shortcut: "l",
        popover: LayersSelector,
      },
    ],
  },
  {
    separator: true,
  },
]);

// const keys = useMagicKeys();

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
</script>

<template>
  <div
    @mouseover="mini = false"
    @mouseleave="mini = true"
    :class="
      cn(
        'bg-white max-h-full overflow-y-auto m-2 py-2 shadow-md flex flex-col gap-2 rounded',
        $attrs.class ?? ''
      )
    "
  >
    <h2 class="px-[.95rem] text-lg font-semibold">
      <span>Pa</span>
      <transition-expand axis="x" :duration="50" easing="ease-out">
        <span v-if="!mini" class="text-nowrap absolute"> rchment </span>
      </transition-expand>
    </h2>

    <div v-for="(item, i) in items" :key="i">
      <Separator v-if="item.separator" />
      <div v-else>
        <div class="flex flex-col px-1">
          <template v-for="subitem in item.items">
            <Button
              v-if="subitem.to"
              variant="ghost"
              class="w-full flex px-3 justify-center gap-3"
              as-child
              :to="subitem.to"
              :class="
                router.currentRoute.value.path === subitem.to
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                  : ''
              "
            >
              <router-link :to="subitem.to">
                <component :is="subitem.icon" class="size-5" />

                <transition-expand axis="x" :duration="50" easing="ease-out">
                  <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                    <div class="flex-1">
                      {{ subitem.label }}
                    </div>

                    <Kbd>
                      <span>⌘</span>
                      {{ subitem.shortcut.toUpperCase() }}
                    </Kbd>
                  </div>
                </transition-expand>
              </router-link>
            </Button>

            <Popover v-if="subitem.popover">
              <PopoverTrigger as-child>
                <Button to="" variant="ghost" class="w-full flex px-3 gap-3">
                  <component :is="subitem.icon" class="size-5" />

                  <transition-expand axis="x" :duration="50" easing="ease-out">
                    <div v-if="!mini" class="flex flex-1 gap-1 text-nowrap">
                      <div class="flex-1 text-start">
                        {{ subitem.label }}
                      </div>

                      <Kbd>
                        <span>⌘</span>
                        {{ subitem.shortcut.toUpperCase() }}
                      </Kbd>
                    </div>
                  </transition-expand>
                </Button>
              </PopoverTrigger>

              <PopoverContent side="right" class="fit-content">
                <component :is="subitem.popover" />
              </PopoverContent>
            </Popover>
          </template>
        </div>
      </div>
    </div>

    <div class="px-2.5 flex items-center gap-2">
      <Avatar size="xs">
        <AvatarImage
          src="https://github.com/alexwohlbruck.png"
          alt="@alexwohlbruck"
        />
        <AvatarFallback>AW</AvatarFallback>
      </Avatar>

      <transition-expand axis="x" :duration="50" easing="ease-out">
        <div class="flex flex-col text-nowrap" v-if="!mini">
          <span class="text-sm font-semibold leading-4">Alex Wohlbruck</span>
          <span class="text-xs text-gray-500 leading-4">Admin</span>
        </div>
      </transition-expand>
    </div>
  </div>
</template>
