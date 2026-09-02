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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { IconPicker } from '@/components/ui/icon-picker'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Spinner } from '@/components/ui/spinner'
import { useCanvasesService } from '@/services/library/canvases.service'
import { useAppService } from '@/services/app.service'
import { useIdentityStore } from '@/stores/identity.store'
import CanvasPrivacySection from './CanvasPrivacySection.vue'
import type { ThemeColor } from '@/lib/utils'
import type { Canvas, CanvasScheme } from '@/types/canvas.types'
import { GlobeIcon, LockIcon } from 'lucide-vue-next'

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

const SCHEMES: { value: CanvasScheme; icon: typeof GlobeIcon }[] = [
  { value: 'server-key', icon: GlobeIcon },
  { value: 'user-e2ee', icon: LockIcon },
]

/**
 * Both directions rewrite the whole canvas, so both confirm — the one that
 * hands contents to the server more loudly than the one that takes them back.
 */
async function switchScheme(target: CanvasScheme) {
  if (!props.canvas || saving.value) return
  const goingPrivate = target === 'user-e2ee'

  const confirmed = await appService.confirm({
    title: t(`canvases.privacy.confirm.${target}.title`),
    description: t(`canvases.privacy.confirm.${target}.description`),
    continueText: t(`canvases.privacy.switchTo.${target}`),
    destructive: !goingPrivate,
  })
  if (!confirmed) return

  saving.value = true
  try {
    const updated = await canvasesService.changeScheme(props.canvas, target)
    if (updated) {
      appService.toast.success(t('canvases.privacy.switched'))
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

        <div v-if="!isEditing" class="space-y-2">
          <Label class="text-xs text-muted-foreground">
            {{ t('canvases.dialog.privacy') }}
          </Label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="option in SCHEMES"
              :key="option.value"
              :disabled="option.value === 'user-e2ee' && !hasIdentity"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'flex flex-col items-start gap-1 p-3 text-left transition-colors',
                option.value === scheme
                  ? 'bg-secondary ring-1 ring-inset ring-primary/50'
                  : 'hover:bg-secondary/40',
                option.value === 'user-e2ee' &&
                  !hasIdentity &&
                  'opacity-50 cursor-not-allowed hover:bg-transparent',
              ]"
              @click="scheme = option.value"
            >
              <component :is="option.icon" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">
                {{ t(`canvases.schemes.${option.value}.title`) }}
              </span>
              <span class="text-[11px] text-muted-foreground leading-snug">
                {{
                  option.value === 'user-e2ee' && !hasIdentity
                    ? t('canvases.privacy.needsIdentity')
                    : t(`canvases.schemes.${option.value}.description`)
                }}
              </span>
            </button>
          </div>
        </div>

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
