<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MapPinPlusIcon, MessageSquarePlusIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { AppRoute } from '@/router'
import type { Place } from '@/types/place.types'

const props = defineProps<{ place: Partial<Place> }>()

const router = useRouter()
const { t } = useI18n()

const site = computed(() => props.place.sources?.[0]?.name ?? '')
const center = computed(() => props.place.geometry?.value?.center)

function at() {
  const { lat, lng } = center.value!
  return { lat: String(lat), lng: String(lng) }
}

function addToMap() {
  router.push({ name: AppRoute.QUICK_EDIT_NEW, query: { ...at(), place: props.place.id } })
}

function tellMappers() {
  const text = t('place.unmapped.noteText', {
    name: props.place.name?.value ?? '',
    address: props.place.address?.value?.formatted ?? '',
    website: props.place.contactInfo?.website?.value ?? '',
  })
  router.push({ name: AppRoute.NOTE_CREATE, query: { ...at(), text } })
}
</script>

<template>
  <div v-if="center" class="rounded-lg border border-dashed px-3 py-3">
    <p class="text-sm font-medium">{{ t('place.unmapped.title') }}</p>
    <p class="mt-0.5 text-sm text-muted-foreground">
      {{ t('place.unmapped.description', { site }) }}
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <Button size="sm" :icon="MapPinPlusIcon" @click="addToMap">
        {{ t('place.unmapped.add') }}
      </Button>
      <Button size="sm" variant="ghost" :icon="MessageSquarePlusIcon" @click="tellMappers">
        {{ t('place.unmapped.note') }}
      </Button>
    </div>
  </div>
</template>
