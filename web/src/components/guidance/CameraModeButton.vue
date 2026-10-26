<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BoxIcon, CompassIcon, LocateFixedIcon, Navigation2Icon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { CameraMode } from '@/lib/guidance/camera-framing'
import type { CameraState } from '@/lib/guidance/camera-gesture'

const props = defineProps<{ mode: CameraMode; state: CameraState }>()
defineEmits<{ press: [] }>()
const { t } = useI18n()

const MODE_ICONS = { 'follow-3d': BoxIcon, 'heading-up': Navigation2Icon, 'north-up': CompassIcon }

const icon = computed(() => (props.state === 'following' ? MODE_ICONS[props.mode] : LocateFixedIcon))
const label = computed(() =>
  props.state === 'following' ? t(`guidance.camera.modes.${props.mode}`) : t('guidance.camera.resume'),
)
</script>

<template>
  <Button
    size="icon"
    :variant="state === 'following' ? 'secondary' : 'default'"
    :title="label"
    :aria-label="label"
    @click="$emit('press')"
  >
    <component :is="icon" class="size-5" />
  </Button>
</template>
