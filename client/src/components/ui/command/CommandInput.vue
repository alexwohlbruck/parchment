<script setup lang="ts">
import { Search } from "lucide-vue-next";
import { ComboboxInput, type ComboboxInputProps } from "radix-vue";
import { cn } from "@/lib/utils";
import Kbd from "../kbd/Kbd.vue";

const props = defineProps<ComboboxInputProps>();
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
};
</script>

<template>
  <div class="flex items-center border-b px-3" cmdk-input-wrapper>
    <Search class="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <ComboboxInput
      v-bind="{ ...props, ...$attrs }"
      :class="
        cn(
          'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-zinc-400',
          $attrs.class ?? ''
        )
      "
    />
    <Kbd class="ml-2">⌘ <span>K</span></Kbd>
  </div>
</template>
