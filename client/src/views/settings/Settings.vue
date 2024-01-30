<script setup lang="ts">
import { useRouter } from "vue-router";

import H2 from "@/components/ui/typography/H2.vue";
import { Separator } from "@/components/ui/separator";
import Button from "@/components/ui/button/Button.vue";

import {
  UserRoundIcon,
  CogIcon,
  PaintbrushIcon,
  DatabaseIcon,
  ActivityIcon,
} from "lucide-vue-next";

const router = useRouter();

const pages = [
  {
    label: "Account",
    to: "/settings/account",
    icon: UserRoundIcon,
    disabled: true,
  },
  {
    label: "Behavior",
    to: "/settings/behavior",
    icon: CogIcon,
  },
  {
    label: "Appearance",
    to: "/settings/appearance",
    icon: PaintbrushIcon,
  },
  {
    label: "Map data",
    to: "/settings/map-data",
    icon: DatabaseIcon,
  },
  {
    label: "System",
    to: "/settings/system",
    icon: ActivityIcon,
    disabled: true,
  },
];
</script>

<template>
  <div class="py-4 flex flex-col gap-4">
    <div>
      <H2>Settings</H2>
      <P>Manage your account settings and app behavior</P>
    </div>

    <Separator />

    <div class="flex gap-4">
      <div class="w-40">
        <Button
          v-for="(page, i) in pages"
          :key="i"
          variant="ghost"
          class="w-full flex px-3 justify-center gap-3"
          as-child
          :to="page.to"
          :class="
            router.currentRoute.value.path === page.to
              ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
              : ''
          "
          :disabled="page.disabled"
        >
          <router-link :to="page.to">
            <component :is="page.icon" class="size-5" />

            <transition-expand axis="x" :duration="50" easing="ease-out">
              <div class="flex flex-1 gap-1 text-nowrap">
                <div class="flex-1">
                  {{ page.label }}
                </div>
              </div>
            </transition-expand>
          </router-link>
        </Button>
      </div>

      <div class="flex-1 mr-4">
        <router-view />
      </div>
    </div>
  </div>
</template>
