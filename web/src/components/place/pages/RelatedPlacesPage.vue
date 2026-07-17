<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  WidgetResponse,
  WidgetDescriptor,
  Place,
  RelatedPlacesData,
  RelatedParent,
} from '@/types/place.types'
import PlaceListItem from '@/components/place/PlaceListItem.vue'
import { api } from '@/lib/api'
import { WidgetType } from '@/types/place.types'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'
import { Skeleton } from '@/components/ui/skeleton'

const { t } = useI18n()

const props = defineProps<{
  data: WidgetResponse<RelatedPlacesData>
  descriptor: WidgetDescriptor
  place: Partial<Place>
  title: string
  /** When rendered inside a place tab: drop the page chrome (header/padding). */
  embedded?: boolean
}>()

const relatedData = computed(() => props.data.data.value as RelatedPlacesData)
const strategy = computed(() => relatedData.value.strategy)
const parents = computed(() => relatedData.value.parents || [])

const localChildren = ref<Place[]>([...(relatedData.value.children || [])])
const isLoadingMore = ref(false)
const hasMore = ref(relatedData.value.hasMore ?? false)
const currentOffset = ref(localChildren.value.length)

watch(
  () => props.data,
  newData => {
    const d = newData.data.value as RelatedPlacesData
    localChildren.value = [...(d.children || [])]
    hasMore.value = d.hasMore ?? false
    currentOffset.value = localChildren.value.length
  },
)

async function loadMore() {
  if (isLoadingMore.value || !hasMore.value) return
  isLoadingMore.value = true
  try {
    const params = {
      ...(props.descriptor.params as Record<string, string>),
      offset: String(currentOffset.value),
    }
    const response = await api.get<WidgetResponse<RelatedPlacesData>>(
      `/places/widgets/${WidgetType.RELATED_PLACES}`,
      { params },
    )
    const newData = response.data.data.value as RelatedPlacesData
    localChildren.value = [...localChildren.value, ...(newData.children || [])]
    hasMore.value = newData.hasMore ?? false
    currentOffset.value = localChildren.value.length
  } catch {
    // silently ignore
  } finally {
    isLoadingMore.value = false
  }
}

const sentinelRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver(
    entries => {
      if (entries[0].isIntersecting) loadMore()
    },
    { threshold: 0.1 },
  )
  if (sentinelRef.value) observer.observe(sentinelRef.value)
})

watch(sentinelRef, el => {
  observer?.disconnect()
  if (el) observer?.observe(el)
})

onUnmounted(() => observer?.disconnect())

function parentToPlace(parent: RelatedParent): Place {
  return {
    id: parent.id,
    name: parent.name
      ? { value: parent.name, sourceId: '', timestamp: '' }
      : null,
    placeType: parent.placeType
      ? { value: parent.placeType, sourceId: '', timestamp: '' }
      : null,
    icon: parent.icon ?? null,
  } as unknown as Place
}

const items = computed(() => {
  if (strategy.value === 'children') return localChildren.value
  return parents.value.map(parentToPlace)
})
</script>

<template>
  <component :is="embedded ? 'div' : PanelLayout">
    <SheetPageHeader v-if="!embedded" :title="title" />

    <div class="space-y-1">
      <PlaceListItem
        v-for="item in items"
        :key="item.id"
        :place="item"
      />

      <!-- Loading skeletons -->
      <template v-if="isLoadingMore">
        <div v-for="i in 3" :key="`skeleton-${i}`">
          <Skeleton class="h-16 rounded-xl" />
        </div>
      </template>

      <!-- Sentinel for infinite scroll -->
      <div
        v-if="hasMore && !isLoadingMore"
        ref="sentinelRef"
        class="h-4"
        aria-hidden="true"
      />
    </div>
  </component>
</template>
