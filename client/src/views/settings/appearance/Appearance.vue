<script setup lang="ts">
import { ref } from "vue";
import H4 from "@/components/ui/typography/H4.vue";
import H6 from "@/components/ui/typography/H6.vue";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ThemeControls from "./ThemeControls.vue";

const mapTheme = ref("auto");
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <H4>Theme</H4>

    <div>
      <H6>App Theme</H6>
      <ThemeControls class="mt-3" />
    </div>

    <form class="flex flex-col gap-4">
      <FormField name="map-theme">
        <FormItem>
          <FormLabel>Map theme</FormLabel>

          <Select v-model="mapTheme">
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="auto">
                  Match app theme and time of day
                </SelectItem>
                <SelectItem value="match">Match app theme</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="dawn">Dawn</SelectItem>
                <SelectItem value="dusk">Dusk</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <!-- <FormDescription> The default app theme </FormDescription> -->
          <FormMessage />
        </FormItem>
      </FormField>
    </form>
  </div>
</template>
