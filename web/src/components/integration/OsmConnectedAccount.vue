<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  IntegrationDefinition,
  IntegrationId,
  IntegrationRecord,
} from '@/types/integrations.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ExternalLinkIcon } from 'lucide-vue-next'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

const props = defineProps<{
  integration: IntegrationDefinition
  config: IntegrationRecord
}>()

const emit = defineEmits<{
  (e: 'update:valid', valid: boolean): void
}>()

const DOCS_BASE = 'https://docs.parchment.app/usage/integrations'

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()

const docsUrl = `${DOCS_BASE}/${props.integration.id}`

const capabilities = ref(
  props.integration.capabilities?.map(capId => ({
    id: capId,
    active:
      props.config?.capabilities?.find(cap => cap.id === capId)?.active ?? true,
  })) ?? [],
)

const osmDisplayName = computed(
  () => (props.config?.config as any)?.osmDisplayName ?? 'Unknown',
)

const osmProfileImageUrl = computed(
  () => (props.config?.config as any)?.osmProfileImageUrl as string | undefined,
)

const osmProfileUrl = computed(() => {
  const osmConfig = integrationsStore.getIntegrationConfig(IntegrationId.OPENSTREETMAP)
  const baseUrl = (osmConfig?.serverUrl as string) || 'https://www.openstreetmap.org'
  return `${baseUrl}/user/${encodeURIComponent(osmDisplayName.value)}`
})

function toggleCapability(capabilityId: string, enabled: boolean) {
  const cap = capabilities.value.find(c => c.id === capabilityId)
  if (cap) {
    cap.active = enabled
  }
}

async function submit() {
  return {
    capabilities: capabilities.value.map(cap => ({
      id: cap.id,
      active: cap.active,
    })),
  }
}

defineExpose({ submit })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
      <ExternalLinkIcon class="size-3.5 shrink-0" />
      <a
        :href="docsUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="underline hover:text-foreground transition-colors"
      >
        {{ t('settings.integrations.viewDocs') }}
      </a>
    </div>

    <!-- Connected account info -->
    <div class="flex items-center gap-4 p-4 border border-border rounded-lg bg-muted/30">
      <Avatar size="sm" shape="circle">
        <AvatarImage v-if="osmProfileImageUrl" :src="osmProfileImageUrl" :alt="osmDisplayName" />
        <AvatarFallback
          class="text-white font-bold"
          :style="{ backgroundColor: integration.color }"
        >
          {{ osmDisplayName[0]?.toUpperCase() }}
        </AvatarFallback>
      </Avatar>
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">{{ osmDisplayName }}</div>
        <a
          :href="osmProfileUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {{ t('settings.integrations.osm.viewProfile') }}
          <ExternalLinkIcon class="size-3" />
        </a>
      </div>
    </div>

    <!-- Capabilities toggles -->
    <div v-if="integration.capabilities?.length > 0" class="space-y-2">
      <div class="block text-sm font-medium text-foreground">
        {{ t('settings.integrations.capabilities.title') }}
      </div>
      <div class="space-y-3 p-3 border border-border rounded-md">
        <div
          v-for="capability in capabilities"
          :key="capability.id"
          class="flex items-center justify-between"
        >
          <Label
            :for="`capability-${capability.id}`"
            class="cursor-pointer"
          >
            {{ t(`settings.integrations.capabilities.${capability.id}`) }}
          </Label>
          <Switch
            :id="`capability-${capability.id}`"
            :model-value="capability.active"
            @update:model-value="enabled => toggleCapability(capability.id, enabled)"
          />
        </div>
      </div>
    </div>

  </div>
</template>
