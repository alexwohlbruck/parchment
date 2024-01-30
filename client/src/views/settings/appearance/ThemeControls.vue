<script setup lang="ts">
import { onMounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-vue-next";

import { RADII, useConfigStore } from "@/stores/settings.store";

import { colors } from "@/lib/registry/colors";
import { useDark } from "@vueuse/core";

type Color =
  | "zinc"
  | "slate"
  | "stone"
  | "gray"
  | "neutral"
  | "red"
  | "rose"
  | "orange"
  | "green"
  | "blue"
  | "yellow"
  | "violet";

const allColors: Color[] = [
  "zinc",
  "rose",
  "blue",
  "green",
  "orange",
  "red",
  "slate",
  "stone",
  "gray",
  "neutral",
  "yellow",
  "violet",
];

const { theme, radius, setRadius, setTheme } = useConfigStore();
const isDark = useDark();

// Whenever the component is mounted, update the document class list
onMounted(() => {
  document.documentElement.style.setProperty("--radius", `${radius.value}rem`);
  document.documentElement.classList.add(`theme-${theme.value}`);
});

// Whenever the theme value changes, update the document class list
watch(theme, (theme) => {
  document.documentElement.classList.remove(
    ...allColors.map((color) => `theme-${color}`)
  );
  document.documentElement.classList.add(`theme-${theme}`);
});

// Whenever the radius value changes, update the document style
watch(radius, (radius) => {
  document.documentElement.style.setProperty("--radius", `${radius}rem`);
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <Label for="color" class="text-xs"> Color </Label>
      <div class="grid grid-cols-3 gap-2 py-1.5">
        <Button
          v-for="(color, index) in allColors"
          :key="index"
          variant="outline"
          class="h-8 justify-start px-3"
          :class="color === theme ? 'border-foreground border-2' : ''"
          @click="setTheme(color)"
        >
          <span
            class="h-5 w-5 rounded-full flex items-center justify-center"
            :style="{ backgroundColor: colors[color][7].rgb }"
          >
            <CheckIcon v-if="color === theme" class="size-3 text-white" />
          </span>
          <span class="ml-2 text-xs capitalize">
            {{ color }}
          </span>
        </Button>
      </div>
    </div>
    <div>
      <Label for="radius" class="text-xs"> Radius </Label>
      <div class="grid grid-cols-5 gap-2 py-1.5">
        <Button
          v-for="(r, index) in RADII"
          :key="index"
          variant="outline"
          class="h-8 justify-center px-3"
          :class="r === radius ? 'border-foreground border-2' : ''"
          @click="setRadius(r)"
        >
          <span class="text-xs">
            {{ r }}
          </span>
        </Button>
      </div>
    </div>
    <div>
      <Label for="theme" class="text-xs"> Theme </Label>

      <div class="flex space-x-2 py-1.5">
        <Button
          class="h-8"
          variant="outline"
          :class="{ 'border-2 border-foreground': !isDark }"
          @click="isDark = false"
        >
          <span class="text-xs">Light</span>
        </Button>
        <Button
          class="h-8"
          variant="outline"
          :class="{ 'border-2 border-foreground': isDark }"
          @click="isDark = true"
        >
          <span class="text-xs">Dark</span>
        </Button>
      </div>
    </div>
  </div>
</template>
