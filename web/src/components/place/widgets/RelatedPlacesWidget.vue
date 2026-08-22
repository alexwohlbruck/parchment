<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SectionHeader } from '@/components/ui/section-header'
import type {
  WidgetResponse,
  WidgetDescriptor,
  Place,
  RelatedPlacesData,
  RelatedParent,
} from '@/types/place.types'
import PlaceListItem from '@/components/place/PlaceListItem.vue'
import { usePlaceTabs } from '@/composables/usePlaceTabs'
import RelatedPlacesPage from '@/components/place/pages/RelatedPlacesPage.vue'

const { t } = useI18n()

const props = defineProps<{
  data: WidgetResponse<RelatedPlacesData>
  descriptor: WidgetDescriptor
  place: Partial<Place>
}>()

const { register, unregister, activate } = usePlaceTabs()

const relatedData = computed(() => props.data.data.value as RelatedPlacesData)
const strategy = computed(() => relatedData.value.strategy)
const parents = computed(() => relatedData.value.parents || [])
const children = computed(() => relatedData.value.children || [])

const hasResults = computed(
  () => children.value.length > 0 || parents.value.length > 0,
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

const itemCount = computed(() => {
  if (strategy.value === 'children') return children.value.length
  return parents.value.length
})

const hasMore = computed(() => relatedData.value.hasMore ?? false)

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

// Compact preview: up to 3 children, or every parent/admin ancestor
const previewItems = computed<Place[]>(() =>
  strategy.value === 'children'
    ? children.value.slice(0, 3)
    : parents.value.map(parentToPlace),
)

// Each related strategy (parent / children / admin) becomes its own tab so
// multiple related sections don't collide.
const tabId = computed(() => `related:${strategy.value}`)
const tabOrder = computed(() =>
  strategy.value === 'children' ? 22 : strategy.value === 'admin' ? 21 : 20,
)

watch(
  [hasResults, tabId, headingText, () => props.data],
  () => {
    if (!hasResults.value) {
      unregister(tabId.value)
      return
    }
    register({
      id: tabId.value,
      label: headingText.value,
      component: markRaw(RelatedPlacesPage),
      props: {
        data: props.data,
        descriptor: props.descriptor,
        place: props.place,
        title: headingText.value,
      },
      order: tabOrder.value,
    })
  },
  { immediate: true },
)
onBeforeUnmount(() => unregister(tabId.value))

function openFullList() {
  activate(tabId.value)
}
</script>

<template>
  <template v-if="hasResults">
    <SectionHeader
      :title="headingText"
      :count="hasMore || itemCount > 3 ? itemCount : undefined"
      :has-more="hasMore"
      clickable
      @select="openFullList"
    />

    <!-- Horizontal scroll preview, bleeding to the panel edges -->
    <div class="edge-bleed relative">
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-3 scroll-px-3 scrollbar-hidden [&>*:first-child]:ml-3 [&>*:last-child]:mr-3"
      >
        <div
          v-for="item in previewItems"
          :key="item.id"
          class="w-64 flex-none snap-start"
        >
          <PlaceListItem :place="item" />
        </div>
      </div>
    </div>
  </template>
</template>
