<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PencilIcon, LinkIcon } from 'lucide-vue-next'
import { useQuickEditService } from '@/services/quick-edit.service'
import { useMapService } from '@/services/map/map.service'
import { useAppService } from '@/services/app.service'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { IntegrationId } from '@/types/integrations.types'
import { AppRoute } from '@/router'
import { LngLat } from '@/types/map.types'
import QuickEditMarker from '@/components/quick-edit/QuickEditMarker.vue'
import PresetPicker from '@/components/quick-edit/PresetPicker.vue'
import PresetIcon from '@/components/quick-edit/PresetIcon.vue'
import DuplicateList from '@/components/quick-edit/DuplicateList.vue'
import QuickEditForm from '@/components/quick-edit/QuickEditForm.vue'
import type {
  DuplicateCandidate,
  EditablePreset,
  PresetSearchResult,
} from '@/types/quick-edit.types'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const quickEditService = useQuickEditService()
const { flyTo, addVueMarker, removeMarker } = useMapService()
const { toast } = useAppService()
const integrationsStore = useIntegrationsStore()

const MARKER_ID = 'quick-edit-marker'

const lat = ref(Number(route.query.lat))
const lng = ref(Number(route.query.lng))
const preset = ref<EditablePreset | null>(null)
const tags = reactive<Record<string, string>>({})
const duplicates = ref<DuplicateCandidate[]>([])
const submitting = ref(false)
const sandboxServer = ref<string | null>(null)

const osmConnected = computed(() =>
  Boolean(
    integrationsStore.getIntegrationConfig(IntegrationId.OPENSTREETMAP_ACCOUNT),
  ),
)

onMounted(async () => {
  placeMarker()
  flyTo({ center: [lng.value, lat.value] })
  const server = await quickEditService.getOsmServer()
  if (server && server.server !== 'production') {
    sandboxServer.value = server.serverUrl.replace(/^https?:\/\//, '')
  }
})

onUnmounted(() => {
  removeMarker(MARKER_ID)
})

function placeMarker() {
  removeMarker(MARKER_ID)
  addVueMarker(
    MARKER_ID,
    { lng: lng.value, lat: lat.value },
    QuickEditMarker,
    {},
    undefined,
    {
      onDragEnd: (lngLat: LngLat) => {
        lat.value = lngLat.lat
        lng.value = lngLat.lng
      },
    },
  )
}

function setTag(key: string, value: string | null) {
  if (value === null) delete tags[key]
  else tags[key] = value
}

async function selectPreset(result: PresetSearchResult) {
  preset.value = await quickEditService.getPreset(result.id)
  for (const key of Object.keys(tags)) delete tags[key]
  for (const [key, value] of Object.entries({
    ...preset.value.tags,
    ...preset.value.addTags,
  })) {
    if (value !== '*') tags[key] = value
  }

  duplicates.value = await quickEditService.findDuplicates(
    lat.value,
    lng.value,
    result.id,
  )
}

function editDuplicate(candidate: DuplicateCandidate) {
  const [type, id] = candidate.osm.split('/')
  router.replace({
    name: AppRoute.QUICK_EDIT_ELEMENT,
    params: { type, id },
  })
}

async function handleSubmit(comment: string) {
  if (!preset.value) return
  submitting.value = true
  try {
    const result = await quickEditService.submitEdit({
      comment: comment || t('quickEdit.defaultAddComment', { name: tags.name || preset.value.name }),
      action: 'create',
      element: {
        type: 'node',
        lat: lat.value,
        lon: lng.value,
        tags: { ...tags },
      },
    })
    toast.success(
      t('quickEdit.submitted', { changeset: result.changesetId }),
    )
    router.replace({ name: AppRoute.MAP })
  } catch (error: any) {
    toast.error(error.response?.data?.message ?? t('quickEdit.submitError'))
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

    <template v-else>
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
            <h2 class="text-lg font-semibold leading-tight">
              {{ preset ? preset.name : t('quickEdit.addTitle') }}
            </h2>
            <button
              v-if="preset"
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground"
              @click="preset = null"
            >
              {{ t('quickEdit.changeType') }}
            </button>
            <span v-else class="text-xs text-muted-foreground">
              {{ lat.toFixed(5) }}, {{ lng.toFixed(5) }}
            </span>
          </div>
        </div>
      </div>

      <template v-if="!preset">
        <p class="mb-3 text-sm text-muted-foreground">
          {{ t('quickEdit.addDescription') }}
        </p>
        <PresetPicker geometry="point" @select="selectPreset" />
      </template>

      <template v-else>
        <DuplicateList
          v-if="duplicates.length"
          :candidates="duplicates"
          class="mb-4"
          @edit="editDuplicate"
        />
        <QuickEditForm
          :preset="preset"
          :tags="tags"
          :submitting="submitting"
          :submit-label="t('quickEdit.submitAdd')"
          :sandbox-server="sandboxServer"
          @set="setTag"
          @submit="handleSubmit"
        />
      </template>
    </template>
  </PanelLayout>
</template>
