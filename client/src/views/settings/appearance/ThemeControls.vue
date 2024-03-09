<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { CheckIcon } from 'lucide-vue-next'
import {
  allRadii,
  useThemeStore,
  allColors,
} from '@/stores/settings/theme.store'
import { colors } from '@/lib/registry/colors'
import { storeToRefs } from 'pinia'

const themeStore = useThemeStore()
const { isDark, accentColor, radius } = storeToRefs(themeStore)
const { toggleDark, setAccentColor, setRadius } = themeStore
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
          :class="color === accentColor ? 'border-foreground border-2' : ''"
          @click="setAccentColor(color)"
        >
          <span
            class="h-5 w-5 rounded-full flex items-center justify-center"
            :style="{ backgroundColor: colors[color][7].rgb }"
          >
            <CheckIcon v-if="color === accentColor" class="size-3 text-white" />
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
          v-for="(r, index) in allRadii"
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
          @click="toggleDark(false)"
        >
          <span class="text-xs">Light</span>
        </Button>
        <Button
          class="h-8"
          variant="outline"
          :class="{ 'border-2 border-foreground': isDark }"
          @click="toggleDark(true)"
        >
          <span class="text-xs">Dark</span>
        </Button>
      </div>
    </div>
  </div>
</template>
