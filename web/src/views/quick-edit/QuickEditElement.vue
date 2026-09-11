<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { PencilIcon, LinkIcon, ClockIcon, InfoIcon, TriangleAlertIcon } from 'lucide-vue-next'
import { useQuickEditService } from '@/services/quick-edit.service'
import { useMapService } from '@/services/map/map.service'
import { useAppService } from '@/services/app.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@/types/integrations.types'
import { AppRoute } from '@/router'
import { LngLat } from '@/types/map.types'
import QuickEditMarker from '@/components/quick-edit/QuickEditMarker.vue'
import PresetIcon from '@/components/quick-edit/PresetIcon.vue'
import QuickEditForm from '@/components/quick-edit/QuickEditForm.vue'
import type {
  EditablePreset,
  OsmElementType,
  OsmLiveElement,
} from '@/types/quick-edit.types'

const props = defineProps<{
  type: string
  id: string
}>()

const router = useRouter()
const { t } = useI18n()
const quickEditService = useQuickEditService()
const { flyTo, addVueMarker, removeMarker } = useMapService()
const { toast } = useAppService()
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

    if (response.element.type === 'node' && response.element.lat !== undefined) {
      const at = { lat: response.element.lat, lng: response.element.lon! }
      flyTo({ center: [at.lng, at.lat] })
      addVueMarker(MARKER_ID, at, QuickEditMarker, {}, undefined, {
        onDragEnd: (lngLat: LngLat) => {
          movedTo.value = lngLat
        },
      })
    }
  } catch (error: any) {
    loadError.value =
      error.response?.data?.message ?? t('quickEdit.loadError')
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  removeMarker(MARKER_ID)
})

function setTag(key: string, value: string | null) {
  if (value === null) delete tags[key]
  else tags[key] = value
}

async function handleSubmit(comment: string) {
  if (!element.value) return
  submitting.value = true
  try {
    const result = await quickEditService.submitEdit({
      comment:
        comment || t('quickEdit.defaultEditComment', { name: displayName.value }),
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
    toast.success(t('quickEdit.submitted', { changeset: result.changesetId }))
    router.back()
  } catch (error: any) {
    if (error.response?.status === 409) {
      toast.error(t('quickEdit.conflictError'))
      const live = error.response.data?.live as OsmLiveElement | undefined
      if (live) {
        element.value = live
        for (const key of Object.keys(tags)) delete tags[key]
        Object.assign(tags, live.tags)
      }
    } else {
      toast.error(error.response?.data?.message ?? t('quickEdit.submitError'))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <PanelLayout>
    <EmptyState
      v-if="!osmConnected"
      :icon="LinkIcon"
      :title="t('quickEdit.connectTitle')"
      :description="t('quickEdit.connectDescription')"
    >
      <template #action>
        <Button @click="router.push({ name: AppRoute.INTEGRATIONS })">
          {{ t('quickEdit.connectAction') }}
        </Button>
      </template>
    </EmptyState>

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
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600"
          >
            <PresetIcon
              v-if="preset"
              :icon="preset.icon"
              size="sm"
              class="text-white"
            />
            <PencilIcon v-else class="size-4 text-white" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold leading-tight">
              {{ displayName }}
            </h2>
            <span class="text-xs text-muted-foreground">
              {{ t('quickEdit.editingElement', { element: `${element.type} ${element.id}` }) }}
            </span>
          </div>
        </div>
      </div>

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
      <p
        v-else
        class="mb-3 text-xs text-muted-foreground"
      >
        {{ t('quickEdit.dragHint') }}
      </p>

      <QuickEditForm
        :preset="preset"
        :tags="tags"
        :submitting="submitting"
        :submit-label="t('quickEdit.submitEdit')"
        :sandbox-server="sandboxServer"
        @set="setTag"
        @submit="handleSubmit"
      />
    </template>
  </PanelLayout>
</template>
