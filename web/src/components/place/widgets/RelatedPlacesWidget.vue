<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
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
import { api } from '@/lib/api'
import { WidgetType } from '@/types/place.types'

const { t } = useI18n()

const props = defineProps<{
  data: WidgetResponse<RelatedPlacesData>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const router = useRouter()

const relatedData = computed(() => props.data.data.value as RelatedPlacesData)
const strategy = computed(() => relatedData.value.strategy)
const parents = computed(() => relatedData.value.parents || [])

// ── Children pagination ─────────────────────────────────────────────────────

const localChildren = ref<Place[]>([...(relatedData.value.children || [])])
const isLoadingMore = ref(false)
const hasMore = ref(relatedData.value.hasMore ?? false)
const currentOffset = ref(localChildren.value.length)

// Reset when the widget data changes (different place)
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
    // silently ignore — user can scroll back to retry
  } finally {
    isLoadingMore.value = false
  }
}

// IntersectionObserver on sentinel element at right edge of scroll container
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

// Re-attach observer when sentinelRef changes
watch(sentinelRef, el => {
  observer?.disconnect()
  if (el) observer?.observe(el)
})

onUnmounted(() => observer?.disconnect())

// ── Derived ─────────────────────────────────────────────────────────────────

const hasResults = computed(
  () => localChildren.value.length > 0 || parents.value.length > 0,
)

const headingText = computed(() => {
  switch (strategy.value) {
    case 'children': {
      const name = props.place.name?.value
      return name
        ? t('place.related.insideName', { name })
        : t('place.related.insideThisPlace')
    }
    case 'parent':
      return t('place.related.locatedIn')
    case 'admin':
      return t('place.related.partOf')
    default:
      return t('place.related.relatedPlaces')
  }
})

/** Convert a lightweight RelatedParent into a minimal Place shape for PlaceListItem. */
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
</script>

<template>
  <!-- Children strategy -->
  <template v-if="hasResults && strategy === 'children'">
    <h3 class="text-sm font-semibold text-muted-foreground">
      {{ headingText }}
    </h3>
    <div class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] relative">
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-3 scroll-px-3 scrollbar-hidden [&>*:first-child>*:first-child]:ml-3 [&>*:last-child>*:last-child]:mr-3"
      >
        <div
          v-for="child in localChildren"
          :key="child.id"
          class="w-64 flex-none snap-start"
        >
          <PlaceListItem :place="child" />
        </div>

        <!-- Loading skeleton cards -->
        <template v-if="isLoadingMore">
          <div
            v-for="i in 3"
            :key="`skeleton-${i}`"
            class="w-64 flex-none snap-start"
          >
            <div class="h-24 rounded-xl bg-muted animate-pulse mx-1" />
          </div>
        </template>

        <!-- Sentinel: triggers loadMore when scrolled into view -->
        <div
          v-if="hasMore && !isLoadingMore"
          ref="sentinelRef"
          class="w-4 flex-none self-stretch"
          aria-hidden="true"
        />
      </div>
    </div>
  </template>

  <!-- Parent / Admin strategy: same horizontal scroll layout as children -->
  <template v-else-if="hasResults">
    <h3 class="text-sm font-semibold text-muted-foreground">
      {{ headingText }}
    </h3>
    <div class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] relative">
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-3 scroll-px-3 scrollbar-hidden [&>*:first-child>*:first-child]:ml-3 [&>*:last-child>*:last-child]:mr-3"
      >
        <div
          v-for="parent in parents"
          :key="parent.id"
          class="w-64 flex-none snap-start"
        >
          <PlaceListItem :place="parentToPlace(parent)" />
        </div>
      </div>
    </div>
  </template>
</template>
