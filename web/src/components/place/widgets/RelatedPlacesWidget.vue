<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRightIcon } from 'lucide-vue-next'
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

// Show up to 3 preview items in the compact view
const previewChildren = computed(() => children.value.slice(0, 3))

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
    <button
      type="button"
      class="w-full text-left flex items-center justify-between gap-2 group"
      @click="openFullList"
    >
      <h3 class="text-sm font-semibold text-muted-foreground">
        {{ headingText }}
        <span v-if="hasMore || itemCount > 3" class="font-normal">({{ itemCount }}{{ hasMore ? '+' : '' }})</span>
      </h3>
      <ChevronRightIcon class="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </button>

    <!-- Children: horizontal scroll preview -->
    <template v-if="strategy === 'children'">
      <div class="ml-[-0.75rem] mr-[-0.75rem] w-[calc(100%+1.5rem)] relative">
        <div
          class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-3 scroll-px-3 scrollbar-hidden [&>*:first-child>*:first-child]:ml-3 [&>*:last-child>*:last-child]:mr-3"
        >
          <div
            v-for="child in previewChildren"
            :key="child.id"
            class="w-64 flex-none snap-start"
          >
            <PlaceListItem :place="child" />
          </div>
        </div>
      </div>
    </template>

    <!-- Parent / Admin: compact list preview -->
    <template v-else>
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
</template>
