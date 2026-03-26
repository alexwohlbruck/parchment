<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type {
  WidgetResponse,
  WidgetDescriptor,
  Place,
  RelatedPlacesData,
  RelatedParent,
} from '@/types/place.types'
import { getPlaceRoute } from '@/lib/place.utils'
import PlaceListItem from '@/components/place/PlaceListItem.vue'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIcon } from '@/components/ui/item-icon'
import { ChevronRightIcon } from 'lucide-vue-next'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'

const themeStore = useThemeStore()

const props = defineProps<{
  data: WidgetResponse<RelatedPlacesData>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const router = useRouter()

const relatedData = computed(() => props.data.data.value as RelatedPlacesData)
const strategy = computed(() => relatedData.value.strategy)
const children = computed(() => relatedData.value.children || [])
const parents = computed(() => relatedData.value.parents || [])

const hasResults = computed(
  () => children.value.length > 0 || parents.value.length > 0,
)

// Heading text
const headingText = computed(() => {
  switch (strategy.value) {
    case 'children': {
      const name = props.place.name?.value
      return name ? `Inside ${name}` : 'Inside this place'
    }
    case 'parent':
      return 'Located in'
    case 'admin':
      return 'Part of'
    default:
      return 'Related Places'
  }
})

function navigateToParent(parent: RelatedParent) {
  const route = getPlaceRoute(`osm/${parent.id}`)
  router.push(route)
}
</script>

<template>
  <!-- Children strategy: fragment with heading + full-bleed gallery as top-level siblings,
       same DOM level as PlaceGallery so the break-out behaves identically. -->
  <template v-if="hasResults && strategy === 'children'">
    <h3 class="text-sm font-semibold text-muted-foreground">
      {{ headingText }}
    </h3>
    <div class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] relative">
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-2 scrollbar-hidden [&>*:first-child>*:first-child]:ml-3 [&>*:last-child>*:last-child]:mr-3"
      >
        <div
          v-for="child in children"
          :key="child.id"
          class="w-64 flex-none snap-start"
        >
          <PlaceListItem :place="child" />
        </div>
      </div>
    </div>
  </template>

  <!-- Parent / Admin strategy: heading + tappable cards in a normal wrapper -->
  <div v-else-if="hasResults" class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted-foreground">
      {{ headingText }}
    </h3>
    <div class="flex flex-col gap-1.5">
      <Card
        v-for="parent in parents"
        :key="parent.id"
        class="cursor-pointer transition-colors hover:bg-muted/30"
        @click="navigateToParent(parent)"
      >
        <CardContent class="px-3 py-3">
          <div class="flex items-center gap-3">
            <ItemIcon
              :icon="parent.icon?.icon || 'Building'"
              :icon-pack="parent.icon?.iconPack || 'lucide'"
              :custom-color="
                parent.icon
                  ? getCategoryColor(parent.icon.category, themeStore.isDark)
                  : undefined
              "
              class="shadow-sm"
              size="sm"
              variant="solid"
              shape="circle"
            />
            <div class="flex-1 min-w-0">
              <span
                class="font-semibold text-sm text-foreground truncate block"
              >
                {{ parent.name }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ parent.placeType }}
              </span>
            </div>
            <ChevronRightIcon class="size-4 text-muted-foreground shrink-0" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.overflow-x-auto::-webkit-scrollbar {
  display: none;
}
.overflow-x-auto {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
