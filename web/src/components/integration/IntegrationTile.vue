<script setup lang="ts">
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useI18n } from 'vue-i18n'
import { Cloud, Trash2 } from 'lucide-vue-next'
import { UiIntegration } from '@/types/integrations.types'

const { t } = useI18n()

const props = defineProps<{
  integration: UiIntegration
}>()

const emit = defineEmits<{
  (e: 'click', integration: UiIntegration): void
  (e: 'delete', integration: UiIntegration): void
}>()

function getInitial(name: string): string {
  return name[0].toUpperCase()
}

function getStatusColors(status: string) {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
    case 'inactive':
      return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
    case 'available':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function handleClick() {
  emit('click', props.integration)
}

function handleDelete(event: Event) {
  // Stop event propagation to prevent the card click handler from firing
  event.stopPropagation()
  emit('delete', props.integration)
}

function isCapabilityEnabled(capability: string): boolean {
  // For active integrations with capability records, check if the capability is active
  if (
    props.integration.status === 'active' &&
    props.integration.capabilityRecords
  ) {
    const capabilityRecord = props.integration.capabilityRecords.find(
      cap => cap.id === capability,
    )
    return capabilityRecord?.active || false
  }

  // For non-active integrations, always return false
  return false
}
</script>

<template>
  <Card
    class="p-4 hover:bg-muted/50 transition-colors cursor-pointer relative"
    @click="handleClick"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between">
        <div
          class="size-12 flex items-center justify-center rounded-lg shadow-md"
          :style="{ backgroundColor: integration.color }"
        >
          <svg
            v-if="integration.icon"
            class="size-7 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
            v-html="integration.icon.svg"
          />
          <span v-else class="text-white font-medium text-lg">
            {{ getInitial(integration.name) }}
          </span>
        </div>
        <div class="flex gap-1 items-center">
          <span
            v-if="integration.paid"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-semibold"
          >
            $
          </span>
          <span
            v-if="integration.cloud"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-semibold flex items-center gap-0.5"
          >
            <Cloud class="size-3" />
          </span>
          <span
            v-if="integration.status"
            class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase"
            :class="getStatusColors(integration.status)"
          >
            {{ t(`settings.integrations.status.${integration.status}`) }}
          </span>
          <Button
            v-if="integration.status === 'active'"
            variant="outline"
            size="icon"
            class="ml-1 size-6 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-950"
            @click="handleDelete"
          >
            <Trash2 class="size-3" />
          </Button>
        </div>
      </div>
      <div>
        <h4 class="font-medium">{{ integration.name }}</h4>
        <p class="text-sm text-muted-foreground line-clamp-2">
          {{
            t(
              `settings.integrations.descriptions.${
                integration.integrationId || integration.id
              }`,
            )
          }}
        </p>
        <div class="flex flex-wrap gap-1 mt-2">
          <span
            v-for="capability in integration.capabilities"
            :key="capability"
            class="text-xs px-2 py-0.5 rounded-full bg-primary/5 text-primary font-semibold inline-flex items-center gap-1"
          >
            <svg
              v-if="isCapabilityEnabled(capability)"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-3"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {{ t(`settings.integrations.capabilities.${capability}`) }}
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>
