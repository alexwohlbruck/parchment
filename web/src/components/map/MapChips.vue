<script setup lang="ts">
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import {
  BikeIcon,
  RockingChairIcon,
  DropletsIcon,
  CoffeeIcon,
  CarIcon,
} from 'lucide-vue-next'
import { Chip } from '@/components/ui/chip'

const router = useRouter()

const chips = [
  {
    icon: BikeIcon,
    label: 'Bike Parking',
    id: 'amenity/bicycle_parking',
  },
  {
    icon: RockingChairIcon,
    label: 'Benches',
    id: 'amenity/bench',
  },
  {
    icon: DropletsIcon,
    label: 'Drinking Water',
    id: 'amenity/drinking_water',
  },
  {
    icon: CoffeeIcon,
    label: 'Cafes',
    id: 'amenity/cafe',
  },
  {
    icon: CarIcon,
    label: 'Car Parking',
    id: 'amenity/parking',
  },
]

function handleChipClick(chip: any) {
  router.push({
    name: AppRoute.SEARCH_RESULTS,
    query: {
      categoryId: chip.id,
      categoryName: chip.label,
    },
  })
}
</script>

<template>
  <div class="flex flex-row gap-1 items-start pb-1">
    <Chip
      v-for="chip in chips"
      :key="chip.id"
      :icon="chip.icon"
      :label="chip.label"
      variant="button"
      size="xs"
      @click="handleChipClick(chip)"
    />
  </div>
</template>
