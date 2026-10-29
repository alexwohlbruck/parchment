<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, Map, MapPin, Pencil, ShieldCheck } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useOsmConnection } from '@/composables/integrations/useOsmConnection'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIntegrationService } from '@/services/integration.service'

const { t } = useI18n()
const integrations = useIntegrationsStore()
const service = useIntegrationService()
const { connect, connecting } = useOsmConnection()
const loading = ref(true)
const connected = computed(() => !!integrations.osmProfile)

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
    <div class="relative flex h-32 items-center justify-center overflow-hidden rounded-2xl border bg-primary/5" aria-hidden="true">
      <div class="absolute inset-0 osm-map-grid opacity-40" />
      <div class="absolute h-48 w-12 rotate-[35deg] border-x-4 border-background bg-primary/10" />
      <div class="relative flex size-20 -rotate-6 items-center justify-center rounded-2xl border bg-background shadow-sm">
        <Map class="size-10 text-primary" :stroke-width="1.5" />
        <span class="absolute -bottom-2 -right-2 flex size-8 rotate-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check v-if="connected" class="size-4" />
          <Pencil v-else class="size-4" />
        </span>
      </div>
    </div>

    <div class="space-y-2 text-center">
      <p class="text-xs font-medium text-muted-foreground">{{ t('onboarding.openstreetmap.optional') }}</p>
      <h2 class="text-2xl font-semibold text-balance">{{ t('onboarding.openstreetmap.title') }}</h2>
      <p class="text-sm leading-relaxed text-muted-foreground">{{ t('onboarding.openstreetmap.description') }}</p>
    </div>

    <div class="space-y-4">
      <div v-for="(icon, benefit) in { notes: MapPin, edits: Pencil }" :key="benefit" class="flex gap-3">
        <component :is="icon" class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div class="space-y-1">
          <p class="text-sm font-medium">{{ t(`onboarding.openstreetmap.${benefit}Title`) }}</p>
          <p class="text-sm text-muted-foreground">{{ t(`onboarding.openstreetmap.${benefit}Description`) }}</p>
        </div>
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
      <p class="text-center text-xs leading-relaxed text-muted-foreground">{{ t('onboarding.openstreetmap.authorization') }}</p>
    </div>

    <div class="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <ShieldCheck class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{{ t('onboarding.openstreetmap.later') }}</p>
    </div>
  </div>
</template>

<style scoped>
.osm-map-grid {
  background-image: linear-gradient(to right, hsl(var(--primary) / 0.12) 1px, transparent 1px),
    linear-gradient(to bottom, hsl(var(--primary) / 0.12) 1px, transparent 1px);
  background-size: 28px 28px;
  transform: rotate(-12deg) scale(1.3);
}
</style>
