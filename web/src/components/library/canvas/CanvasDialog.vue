<script setup lang="ts">
/**
 * Create or rename a canvas.
 *
 * Creating offers the two schemes side by side; editing shows the one in use
 * with a way to switch. They're different affordances because they're
 * different acts — picking at the start is free, changing later re-packages
 * the whole canvas under the other scheme and confirms first.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { IconPicker } from '@/components/ui/icon-picker'
import { Spinner } from '@/components/ui/spinner'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useAppService } from '@/services/app.service'
import { useIdentityStore } from '@/stores/identity.store'
import CanvasPrivacySection from './CanvasPrivacySection.vue'
import PrivacyPicker from '@/components/library/privacy/PrivacyPicker.vue'
import type { ThemeColor } from '@/lib/utils'
import type { Canvas, CanvasScheme } from '@/types/canvas.types'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  /** Present when renaming; absent when creating. */
  canvas?: Canvas | null
}>()

const emit = defineEmits<{ created: [canvas: Canvas] }>()

const { t } = useI18n()
const canvasesService = useCanvasesService()
const appService = useAppService()
const identityStore = useIdentityStore()

/** Encrypting a canvas needs a key; a device without one can still make a
 *  shareable canvas, so the option is disabled rather than the whole dialog. */
const hasIdentity = computed(() => identityStore.isSetupComplete)

const name = ref('')
const description = ref('')
const icon = ref('MapIcon')
const iconColor = ref<ThemeColor>('iris')
const scheme = ref<CanvasScheme>('server-key')
const saving = ref(false)

const isEditing = computed(() => !!props.canvas)

watch(open, isOpen => {
  if (!isOpen) return
  name.value = props.canvas?.name ?? ''
  description.value = props.canvas?.description ?? ''
  icon.value = props.canvas?.icon ?? 'MapIcon'
  iconColor.value = (props.canvas?.iconColor as ThemeColor) ?? 'iris'
  scheme.value = props.canvas?.scheme ?? 'server-key'
})

/**
 * Both directions rewrite the whole canvas, so both confirm — the one that
 * hands contents to the server more loudly than the one that takes them back.
 */
async function switchScheme(target: CanvasScheme) {
  if (!props.canvas || saving.value) return
  const goingPrivate = target === 'user-e2ee'

  const confirmed = await appService.confirm({
    title: t(`library.privacy.confirm.canvas.${target}.title`),
    description: t(`library.privacy.confirm.canvas.${target}.description`),
    continueText: t(`library.privacy.switchTo.${target}`),
    destructive: !goingPrivate,
  })
  if (!confirmed) return

  saving.value = true
  try {
    const updated = await canvasesService.changeScheme(props.canvas, target)
    if (updated) {
      appService.toast.success(t('library.privacy.switched'))
      open.value = false
    }
  } finally {
    saving.value = false
  }
}

// ── Link sharing ─────────────────────────────────────────────────────────────

const shareUrl = computed(() =>
  props.canvas?.publicToken
    ? `${window.location.origin}/c/${props.canvas.publicToken}`
    : null,
)

async function createShareLink() {
  if (!props.canvas || saving.value) return
  saving.value = true
  try {
    const url = await canvasesService.createShareLink(props.canvas)
    if (url) await copy(url)
  } finally {
    saving.value = false
  }
}

async function revokeShareLink() {
  if (!props.canvas || saving.value) return
  const confirmed = await appService.confirm({
    title: t('canvases.share.revokeConfirm.title'),
    description: t('canvases.share.revokeConfirm.description'),
    continueText: t('canvases.share.revoke'),
    destructive: true,
  })
  if (!confirmed) return

  saving.value = true
  try {
    await canvasesService.revokeShareLink(props.canvas)
  } finally {
    saving.value = false
  }
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    appService.toast.success(t('canvases.share.copied'))
  } catch {
    // Clipboard access can be refused; the URL is on screen to select.
  }
}

function copyShareLink() {
  if (shareUrl.value) void copy(shareUrl.value)
}

async function submit() {
  if (!name.value.trim() || saving.value) return
  saving.value = true
  try {
    if (props.canvas) {
      await canvasesService.updateMetadata(props.canvas, {
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        icon: icon.value,
        iconColor: iconColor.value,
      })
    } else {
      const created = await canvasesService.createCanvas({
        name: name.value.trim(),
        description: description.value.trim() || undefined,
        icon: icon.value,
        iconColor: iconColor.value,
        scheme: scheme.value,
      })
      if (created) emit('created', created)
    }
    open.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t(isEditing ? 'canvases.dialog.editTitle' : 'canvases.dialog.newTitle')"
    :description="t('canvases.dialog.description')"
  >
    <template #content>
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          <IconPicker
            :model-value="{ icon, color: iconColor }"
            @update:model-value="
              v => {
                icon = v.icon
                iconColor = v.color
              }
            "
          />
          <Input
            v-model="name"
            class="h-9"
            :placeholder="t('canvases.dialog.namePlaceholder')"
            @keydown.enter="submit"
          />
        </div>

        <Textarea
          v-model="description"
          :rows="2"
          :placeholder="t('canvases.dialog.descriptionPlaceholder')"
        />

        <PrivacyPicker v-if="!isEditing" v-model="scheme" :has-identity="hasIdentity" />

        <CanvasPrivacySection
          v-else-if="canvas"
          :scheme="canvas.scheme"
          :has-identity="hasIdentity"
          :share-url="shareUrl"
          :disabled="saving"
          @switch="switchScheme"
          @share="createShareLink"
          @revoke-share="revokeShareLink"
          @copy-share="copyShareLink"
        />

        <Button class="w-full" :disabled="!name.trim() || saving" @click="submit">
          <Spinner v-if="saving" class="size-3.5" />
          {{ t(isEditing ? 'general.save' : 'general.create') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
