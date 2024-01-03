<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
</script>

<template>
  <div :class="cn('pb-12', $attrs.class ?? '')">
    <div class="space-y-4 py-4">
      <div class="px-3 py-2">
        <h2 class="mb-2 px-4 text-lg font-semibold">Explore</h2>
        <div class="space-y-1">
          <Button variant="secondary" class="w-full justify-start">
            <Icon class="mr-2" :path="mdiMapOutline"></Icon>
            Map
          </Button>
          <Button variant="ghost" class="w-full justify-start">
            <Icon class="mr-2" :path="mdiMagnify"></Icon>
            Search
          </Button>
          <Button variant="ghost" class="w-full justify-start">
            <Icon class="mr-2" :path="mdiDirections"></Icon>
            Directions
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
