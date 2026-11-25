<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { GlobeIcon } from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'
import { useAskService } from '@/services/ask/ask.service'
import { usePlaceService } from '@/services/place/place.service'
import { useMapService } from '@/services/map/map.service'
import { isAskOffered } from '@/lib/ask/ask-access'
import { getPlaceRoute } from '@/lib/place/place-route'

const props = defineProps<{ query: string }>()

const router = useRouter()
const { t } = useI18n()
const askService = useAskService()
const { setPartialPlace } = usePlaceService()
const mapService = useMapService()

const offered = ref(false)
const finding = ref(false)
const missing = ref<string | null>(null)

onMounted(async () => {
  offered.value = isAskOffered(await askService.loadAccess().catch(() => null))
})

async function find() {
  finding.value = true
  missing.value = null
  try {
    const { lat, lng } = mapService.getCenter()
    const lookup = await askService.findPlaceOnWeb(props.query, { lat, lng })
    if (lookup.status === 'not-found') {
      missing.value = lookup.reason
      return
    }
    setPartialPlace(lookup.place)
    router.push(getPlaceRoute(lookup.place.id))
  } finally {
    finding.value = false
  }
}
</script>

<template>
  <div v-if="offered && query.trim()">
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted disabled:opacity-70"
      :disabled="finding"
      @click="find"
    >
      <Spinner v-if="finding" class="size-4 shrink-0 text-muted-foreground" />
      <GlobeIcon v-else class="size-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0">
        <span class="block truncate text-sm font-medium">
          {{ finding ? t('place.unmapped.finding') : t('place.unmapped.findOnWeb', { query }) }}
        </span>
        <span class="block text-xs text-muted-foreground">
          {{ missing ?? t('place.unmapped.findOnWebHint') }}
        </span>
      </span>
    </button>
  </div>
</template>
