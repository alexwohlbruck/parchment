<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRoundIcon } from 'lucide-vue-next'
import {
  siBluesky,
  siGithub,
  siGoogle,
  siOpenstreetmap,
} from 'simple-icons/icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import BrandIcon from '@/components/ui/brand-icon/BrandIcon.vue'
import type { MangroveProvider } from '@/services/place/mangrove-review.service'

defineProps<{ waiting: boolean }>()

const emit = defineEmits<{
  signIn: [provider: MangroveProvider]
  cancel: []
}>()

const { t } = useI18n()

const root = useTemplateRef<HTMLElement>('root')
onMounted(() => root.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))

const providers = [
  { id: 'osm', label: 'OpenStreetMap', icon: siOpenstreetmap },
  { id: 'bluesky', label: 'Bluesky', icon: siBluesky },
  { id: 'google', label: 'Google', icon: siGoogle },
  { id: 'github', label: 'GitHub', icon: siGithub },
] as const
</script>

<template>
  <div ref="root" class="space-y-3 rounded-lg border p-3">
    <div class="space-y-1">
      <p class="text-sm font-medium">{{ t('place.reviews.signIn.title') }}</p>
      <p class="text-xs text-muted-foreground">
        {{ t('place.reviews.signIn.description') }}
      </p>
    </div>

    <div v-if="waiting" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner class="size-4" />
      {{ t('place.reviews.signIn.waiting') }}
      <Button size="sm" variant="ghost" class="ml-auto" @click="emit('cancel')">
        {{ t('general.cancel') }}
      </Button>
    </div>

    <div v-else class="grid grid-cols-2 gap-2">
      <Button
        v-for="provider in providers"
        :key="provider.id"
        size="sm"
        variant="outline"
        class="justify-start gap-2"
        @click="emit('signIn', provider.id)"
      >
        <BrandIcon :icon="provider.icon" :size="14" use-theme-color />
        {{ provider.label }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        class="justify-start gap-2"
        @click="emit('signIn', 'passkey')"
      >
        <KeyRoundIcon class="size-3.5" />
        {{ t('place.reviews.signIn.passkey') }}
      </Button>
      <Button size="sm" variant="ghost" @click="emit('cancel')">
        {{ t('general.cancel') }}
      </Button>
    </div>
  </div>
</template>
