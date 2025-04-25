<script setup lang="ts">
import { computed } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreVerticalIcon, Pencil, Trash } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Collection } from '@/types/library.types'
import {
  getIconFromString,
  getThemeColorClasses,
  type ThemeColor,
} from '@/lib/utils'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()

const collectionIcon = computed(() => {
  return getIconFromString(props.collection.icon)
})

const colorClasses = computed(() => {
  return getThemeColorClasses(props.collection.iconColor as ThemeColor)
})

function goToCollection() {
  router.push({
    name: AppRoute.COLLECTION,
    params: { id: props.collection.id },
  })
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="goToCollection"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <!-- Icon -->
      <div
        class="size-10 rounded-md flex items-center justify-center flex-shrink-0"
        :class="colorClasses"
      >
        <component :is="collectionIcon" class="size-5" />
      </div>

      <!-- Content -->
      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <h3 class="font-semibold text-sm">{{ collection.name }}</h3>

            <!-- Display collection description if available -->
            <div
              v-if="collection.description"
              class="text-xs text-muted-foreground line-clamp-2"
            >
              {{ collection.description }}
            </div>
          </div>

          <!-- Actions dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child @click.stop>
              <Button variant="ghost" size="icon" class="size-8">
                <MoreVerticalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Pencil class="size-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem class="text-destructive">
                <Trash class="size-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
