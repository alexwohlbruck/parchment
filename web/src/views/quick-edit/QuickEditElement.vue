<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import {
  PencilIcon,
  ClockIcon,
  InfoIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useQuickEditService } from '@/services/quick-edit.service'
import { usePlaceService } from '@/services/place/place.service'
import { useMapService } from '@/services/map/map.service'
import { useAppService } from '@/services/app.service'
import { useExternalLink } from '@/composables/useExternalLink'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@/types/integrations.types'
import { LngLat } from '@/types/map.types'
import ConnectPrompt from '@/components/quick-edit/ConnectPrompt.vue'
import QuickEditMarker from '@/components/quick-edit/QuickEditMarker.vue'
import PresetIcon from '@/components/quick-edit/PresetIcon.vue'
import PresetPicker from '@/components/quick-edit/PresetPicker.vue'
import QuickEditForm from '@/components/quick-edit/QuickEditForm.vue'
import BrandLogo from '@/components/quick-edit/BrandLogo.vue'
import { whenMapReady } from '@/composables/map/whenMapReady'
import { retagForPreset } from '@/lib/quick-edit/preset-tags'
import type {
  BrandChoice,
  EditablePreset,
  NsiBrand,
  OsmElementType,
  OsmLiveElement,
  PresetSummary,
} from '@/types/quick-edit.types'

const props = defineProps<{
  type: string
  id: string
}>()

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const quickEditService = useQuickEditService()
const placeService = usePlaceService()
const { flyTo, addVueMarker, removeMarker } = useMapService()
const { toast } = useAppService()
const { openExternalLink } = useExternalLink()
const integrationsStore = useIntegrationsStore()

const MARKER_ID = 'quick-edit-marker'

const loading = ref(true)
const loadError = ref<string | null>(null)
const element = ref<OsmLiveElement | null>(null)
const preset = ref<EditablePreset | null>(null)
const tags = reactive<Record<string, string>>({})
const movedTo = ref<LngLat | null>(null)
const hasPendingEdit = ref(false)
const submitting = ref(false)
const sandboxServer = ref<string | null>(null)
const osmServerUrl = ref<string | null>(null)
const brandLogo = ref<string | null>(null)
const markerAt = ref<LngLat | null>(null)
const choosingType = ref(false)

const osmConnected = computed(() =>
  Boolean(
    integrationsStore.getIntegrationConfig(IntegrationId.OPENSTREETMAP_ACCOUNT),
  ),
)

const displayName = computed(
  () => tags.name || preset.value?.name || `${props.type}/${props.id}`,
)

onMounted(async () => {
  try {
    const [response, server] = await Promise.all([
      quickEditService.getElement(props.type as OsmElementType, props.id),
      quickEditService.getOsmServer(),
    ])
    element.value = response.element
    preset.value = response.preset
    Object.assign(tags, response.element.tags)
    osmServerUrl.value = server?.serverUrl ?? null
    if (server && server.server !== 'production') {
      sandboxServer.value = server.serverUrl.replace(/^https?:\/\//, '')
    }

    if (osmConnected.value) {
      const pending = await quickEditService.getPendingEdits({
        type: props.type,
        id: props.id,
      })
      if (pending.length) {
        hasPendingEdit.value = true
        Object.assign(tags, pending[0].tags)
      }
    }

    if (typeof route.query.place === 'string') await takeOver(route.query.place)

    if (
      response.element.type === 'node' &&
      response.element.lat !== undefined
    ) {
      const at = { lat: response.element.lat, lng: response.element.lon! }
      markerAt.value = at
      whenMapReady(() => {
        flyTo({ center: [at.lng, at.lat], zoom: 18 })
        placeMarker()
      })
    }
  } catch (error: any) {
    const status = error.response?.status
    if ((status === 404 || status === 410) && typeof route.query.place === 'string') {
      await addInstead(route.query.place)
      return
    }
    loadError.value = error.response?.data?.message ?? t('quickEdit.loadError')
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  clearTimeout(labelTimer)
  removeMarker(MARKER_ID)
})

function placeMarker() {
  const at = movedTo.value ?? markerAt.value
  if (!at) return
  removeMarker(MARKER_ID)
  addVueMarker(
    MARKER_ID,
    at,
    QuickEditMarker,
    {
      iconName: preset.value?.iconName,
      iconPack: preset.value?.iconPack,
      category: preset.value?.iconCategory,
      label: tags.name,
    },
    undefined,
    {
      onDragEnd: (lngLat: LngLat) => {
        movedTo.value = lngLat
      },
    },
  )
}

/** Fills the form with a business found on its own site that now occupies this element's address. */
async function takeOver(placeId: string) {
  const unmapped = (await placeService.lookupPlaceById(placeId))?.unmapped
  const replaces = unmapped?.replaces
  if (!unmapped || replaces?.type !== props.type || String(replaces.id) !== props.id) return
  for (const key of Object.keys(tags)) delete tags[key]
  Object.assign(tags, unmapped.tags)
  if (unmapped.presetId) await selectPreset({ id: unmapped.presetId } as PresetSummary)
}

/** The element is gone from OSM since our copy was taken, so the business goes in as a new place. */
async function addInstead(placeId: string) {
  const center = (await placeService.lookupPlaceById(placeId))?.geometry?.value?.center
  if (!center) return
  router.replace({
    name: AppRoute.QUICK_EDIT_NEW,
    query: { lat: String(center.lat), lng: String(center.lng), place: placeId },
  })
}

function setTag(key: string, value: string | null) {
  if (value === null) delete tags[key]
  else tags[key] = value
}

// Marker props are set when the marker is created, so the pin is re-placed to
// pick up a new name. Debounced: otherwise it remounts on every keystroke.
let labelTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => tags.name,
  () => {
    clearTimeout(labelTimer)
    labelTimer = setTimeout(placeMarker, 400)
  },
)

function applyBrand(brand: NsiBrand) {
  for (const [key, value] of Object.entries(brand.tags)) tags[key] = value
  brandLogo.value = brand.logoUrl
}

async function selectPreset(result: PresetSummary) {
  const next = await quickEditService.getPreset(result.id)
  const retagged = retagForPreset(tags, preset.value, next)
  for (const key of Object.keys(tags)) delete tags[key]
  Object.assign(tags, retagged)
  preset.value = next
  choosingType.value = false
  placeMarker()
}

async function selectBrand(choice: BrandChoice) {
  await selectPreset(choice.preset)
  applyBrand(choice.brand)
}

/** Success, with a way through to the changeset it produced. */
function announceSubmitted(changesetId: number) {
  const url = osmServerUrl.value
    ? `${osmServerUrl.value}/changeset/${changesetId}`
    : null
  toast.success(t('quickEdit.submitted'), {
    action: url
      ? {
          label: t('quickEdit.viewChangeset'),
          onClick: () => openExternalLink(url, '_blank'),
        }
      : undefined,
  })
}

async function handleSubmit(comment: string) {
  if (!element.value) return
  submitting.value = true
  try {
    const result = await quickEditService.submitEdit({
      comment:
        comment ||
        t('quickEdit.defaultEditComment', { name: displayName.value }),
      action: 'modify',
      element: {
        type: element.value.type,
        id: element.value.id,
        version: element.value.version,
        lat: movedTo.value?.lat,
        lon: movedTo.value?.lng,
        tags: { ...tags },
      },
    })
    announceSubmitted(result.changesetId)
    router.back()
  } catch (error: any) {
    if (error.response?.status === 409) {
      toast.error(t('quickEdit.conflictError'), { cause: error })
      const live = error.response.data?.live as OsmLiveElement | undefined
      if (live) {
        element.value = live
        for (const key of Object.keys(tags)) delete tags[key]
        Object.assign(tags, live.tags)
      }
    } else {
      toast.error(error.response?.data?.message ?? t('quickEdit.submitError'), {
        cause: error,
      })
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <PanelLayout>
    <ConnectPrompt v-if="!osmConnected" />

    <div v-else-if="loading" class="flex justify-center py-12">
      <Spinner size="sm" />
    </div>

    <EmptyState
      v-else-if="loadError"
      :icon="TriangleAlertIcon"
      :title="t('quickEdit.loadErrorTitle')"
      :description="loadError"
    />

    <template v-else-if="element">
      <div class="mb-4 flex items-start gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <BrandLogo
            v-if="tags['brand:wikidata']"
            :src="brandLogo"
            :name="displayName"
            size="sm"
          />
          <PresetIcon v-else-if="preset" :preset="preset" size="sm" />
          <div
            v-else
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600"
          >
            <PencilIcon class="size-4 text-white" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold leading-tight">
              {{ displayName }}
            </h2>
            <span class="block text-xs text-muted-foreground">
              {{
                t('quickEdit.editingElement', {
                  element: `${element.type} ${element.id}`,
                })
              }}
            </span>
            <button
              type="button"
              class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              @click="choosingType = !choosingType"
            >
              {{
                choosingType ? t('general.cancel') : t('quickEdit.changeType')
              }}
            </button>
          </div>
        </div>
      </div>

      <PresetPicker
        v-if="choosingType"
        :geometry="element.type === 'node' ? 'point' : undefined"
        @select="selectPreset"
        @select-brand="selectBrand"
      />

      <template v-else>
        <div
          v-if="hasPendingEdit"
          class="mb-3 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          <ClockIcon class="size-3.5 shrink-0" />
          {{ t('quickEdit.pendingNotice') }}
        </div>

        <div
          v-if="element.type !== 'node'"
          class="mb-3 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          <InfoIcon class="size-3.5 shrink-0" />
          {{ t('quickEdit.geometryNotice') }}
        </div>
        <p v-else class="mb-3 text-xs text-muted-foreground">
          {{ t('quickEdit.dragHint') }}
        </p>

        <QuickEditForm
          :preset="preset"
          :tags="tags"
          :submitting="submitting"
          :submit-label="t('quickEdit.submitEdit')"
          :lat="movedTo?.lat ?? element.lat ?? 0"
          :lng="movedTo?.lng ?? element.lon ?? 0"
          :sandbox-server="sandboxServer"
          @set="setTag"
          @brand="applyBrand"
          @logo="brandLogo = $event"
          @submit="handleSubmit"
        />
      </template>
    </template>
  </PanelLayout>
</template>
