<script setup lang="ts">
import OnboardingHeader from './OnboardingHeader.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, Map, MapPin, Pencil } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useOsmConnection } from '@/composables/integrations/useOsmConnection'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIntegrationService } from '@/services/integration.service'

const emit = defineEmits<{ complete: [] }>()

const { t } = useI18n()
const integrations = useIntegrationsStore()
const service = useIntegrationService()
const { connect, connecting } = useOsmConnection()
const loading = ref(true)
const connected = computed(() => !!integrations.osmProfile)

watch(connected, isConnected => {
  if (isConnected) emit('complete')
})

async function load() {
  loading.value = true
  try {
    await service.fetchConfiguredIntegrations()
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-6">
    <OnboardingHeader
      :title="t('onboarding.openstreetmap.title')"
      :description="t('onboarding.openstreetmap.description')"
      :icon="Map"
    >
      <template #badge>
        <Check v-if="connected" class="size-4" />
        <Pencil v-else class="size-4" />
      </template>
    </OnboardingHeader>

    <div class="space-y-4">
      <div v-for="(icon, benefit) in { notes: MapPin, edits: Pencil }" :key="benefit" class="flex gap-3">
        <component :is="icon" class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p class="text-sm font-medium">{{ t(`onboarding.openstreetmap.${benefit}Title`) }}</p>
      </div>
    </div>

    <div v-if="connected" role="status" class="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <Check class="size-5 shrink-0 text-primary" aria-hidden="true" />
      <div class="min-w-0 space-y-1">
        <p class="text-sm font-medium">{{ t('onboarding.openstreetmap.connected') }}</p>
        <p class="break-words text-sm text-muted-foreground">{{ integrations.osmProfile?.osmDisplayName }}</p>
      </div>
    </div>
    <div v-else class="space-y-3">
      <Button class="w-full" :disabled="loading || connecting" @click="connect">
        <Spinner v-if="loading || connecting" class="mr-2 size-4" />
        {{ t('onboarding.openstreetmap.connect') }}
        <ExternalLink v-if="!loading && !connecting" class="ml-2 size-4" aria-hidden="true" />
      </Button>
    </div>

  </div>
</template>
