<script setup lang="ts">
import H4 from "@/components/ui/typography/H4.vue";
import H5 from "@/components/ui/typography/H5.vue";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { SettingsIcon, PlusIcon } from "lucide-vue-next";

import layerTypes from "../../components/map/layers";
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <div>
      <H4>Layers</H4>
      <P>Choose layers to display in the layer selector</P>
    </div>

    <div
      class="flex flex-col gap-2"
      v-for="(layerType, i) in Object.values(layerTypes)"
      :key="i"
    >
      <H5>{{ layerType.name }}</H5>

      <div class="flex gap-2">
        <Card
          v-for="(layer, j) in layerType.layers"
          :key="j"
          class="p-2 flex items-center gap-2"
        >
          <Checkbox id="test" class="mx-2" />
          <span>{{ layer.name }}</span>
          <Button variant="ghost" size="icon">
            <SettingsIcon class="size-4" />
          </Button>
        </Card>
      </div>
    </div>

    <Button variant="ghost">
      <PlusIcon class="size-4 mr-2" />
      Configure new layer
    </Button>
  </div>
</template>
