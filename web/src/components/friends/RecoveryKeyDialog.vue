<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { useAppService } from '@/services/app.service'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'
import {
  Key,
  Check,
  Copy,
  Download,
  AtSign,
  Fingerprint,
  Smartphone,
} from 'lucide-vue-next'

import RecoveryKeySetupContent from './RecoveryKeySetupContent.vue'
import PasskeyOfferContent from './PasskeyOfferContent.vue'
import TransferIdentityDialog from './TransferIdentityDialog.vue'
import { useDialogCompletion } from '@/composables/useDialogCompletion'
import { useClipboard } from '@/composables/useClipboard'

type Mode = 'setup' | 'import' | 'view'
type SetupStep =
  | 'generate'
  | 'passkey-offer'
  | 'complete'
type ImportStep = 'choose' | 'type-key' | 'complete'

interface Props {
  open: boolean
  mode?: Mode
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'setup',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  complete: []
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const appService = useAppService()
const { isLoading, handle, hasAnyPasskeySlot } =
  storeToRefs(identityStore)

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const recoveryKeyInput = ref('')
const existingRecoveryKey = ref<string | null>(null)
const { copied: recoveryCopied, copy: copyText } = useClipboard()
const error = ref<string | null>(null)
const setupStep = ref<SetupStep>('generate')
const importStep = ref<ImportStep>('choose')
const showTransferDialog = ref(false)
const recoveryKeySetupRef = ref<InstanceType<typeof RecoveryKeySetupContent> | null>(null)

const dismissWithCompletion = useDialogCompletion(isOpen, emit)

function openTransferDialog() {
  showTransferDialog.value = true
}

function handleTransferComplete() {
  isOpen.value = false
  emit('complete')
}

watch(
  () => props.open,
  async open => {
    if (open && props.mode === 'setup') {
      setupStep.value = 'generate'
      error.value = null
      await identityStore.startSetup()
    } else if (open && props.mode === 'view') {
      existingRecoveryKey.value = await identityStore.fetchRecoveryKey()
    } else if (open && props.mode === 'import') {
      importStep.value = 'choose'
      error.value = null
      recoveryKeyInput.value = ''
      await identityStore.refreshSlotAvailability()
      if (!hasAnyPasskeySlot.value) importStep.value = 'type-key'
    }
  },
)

const displayedKey = computed(() => {
  if (props.mode === 'view') return existingRecoveryKey.value
  return null
})

const formattedKey = computed(() => {
  const k = displayedKey.value
  if (!k) return ''
  return k.match(/.{1,5}/g)?.join(' ') ?? k
})

function handleSetupConfirm() {
  setupStep.value = 'passkey-offer'
}

function handlePasskeyComplete() {
  setupStep.value = 'complete'
  dismissWithCompletion()
}

function handlePasskeySkip() {
  setupStep.value = 'complete'
  dismissWithCompletion()
}

async function handleUnlockWithPasskey() {
  error.value = null
  const result = await identityStore.unlockWithPasskey()
  if (result.cancelled) return
  if (result.success) {
    importStep.value = 'complete'
    dismissWithCompletion()
  } else {
    error.value = result.error || t('settings.identity.recoveryKey.import.unlockFailed')
  }
}

async function handleImport() {
  if (!recoveryKeyInput.value.trim()) return

  error.value = null
  const result = await identityStore.importFromRecoveryKey(
    recoveryKeyInput.value,
  )

  if (result.success) {
    importStep.value = 'complete'
    dismissWithCompletion()
  } else {
    error.value = result.error || t('settings.identity.recoveryKey.import.invalidKey')
  }
}

async function handleResetIdentity() {
  const confirmed = await appService.componentDialog({
    component: (await import('@/components/admin/DeleteConfirmForm.vue')).default,
    props: {
      confirmValue: 'RESET',
      warning: t('settings.identity.recoveryKey.reset.confirmDescription'),
    },
    title: t('settings.identity.recoveryKey.reset.confirmTitle'),
    destructive: true,
    contentClass: 'md:max-w-md lg:max-w-md',
    continueText: t('settings.identity.recoveryKey.reset.typePromptTitle'),
  })
  if (!confirmed) return

  error.value = null
  const result = await identityStore.resetIdentity()
  if (!result.success) {
    error.value = result.error ?? t('settings.identity.recoveryKey.reset.failedFallback')
    return
  }
  isOpen.value = false
  emit('complete')
}

function handleClose() {
  if (
    props.mode === 'setup' &&
    setupStep.value !== 'complete' &&
    setupStep.value !== 'passkey-offer'
  ) {
    identityStore.cancelSetup()
  }
  isOpen.value = false
  recoveryKeyInput.value = ''
  error.value = null
  setupStep.value = 'generate'
  importStep.value = 'choose'
  recoveryKeySetupRef.value?.reset()
}

async function copyRecoveryKey() {
  if (!existingRecoveryKey.value) return
  await copyText(existingRecoveryKey.value, t('settings.identity.recoveryKey.setup.keyCopiedToast'))
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <!-- Setup Mode -->
      <template v-if="mode === 'setup'">
        <!-- Main recovery-key display + confirm step -->
        <template v-if="setupStep === 'generate'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Key class="h-5 w-5" />
              {{ t('settings.identity.recoveryKey.setup.title') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.setup.description') }}
            </DialogDescription>
          </DialogHeader>

          <div class="py-4">
            <RecoveryKeySetupContent
              ref="recoveryKeySetupRef"
              @confirm="handleSetupConfirm"
              @cancel="handleClose"
            />
          </div>
        </template>

        <!-- Passkey enrollment offer -->
        <template v-else-if="setupStep === 'passkey-offer'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Fingerprint class="h-5 w-5" />
              {{ t('settings.identity.recoveryKey.passkeyOffer.title') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.passkeyOffer.description') }}
            </DialogDescription>
          </DialogHeader>

          <div class="py-4">
            <PasskeyOfferContent
              @complete="handlePasskeyComplete"
              @skip="handlePasskeySkip"
            />
          </div>
        </template>

        <!-- Complete -->
        <template v-else-if="setupStep === 'complete'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Check class="h-5 w-5 text-forest-600" />
              {{ t('settings.identity.recoveryKey.complete.title') }}
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-forest-500 text-forest-600">
              <Check class="h-4 w-4" />
              <AlertDescription>
                {{ t('settings.identity.recoveryKey.complete.message') }}
                <span v-if="handle" class="block mt-1 font-mono text-xs">
                  {{ t('settings.identity.recoveryKey.complete.federationId', { handle }) }}
                </span>
              </AlertDescription>
            </Alert>
          </div>
        </template>
      </template>

      <!-- Import Mode -->
      <template v-else-if="mode === 'import'">
        <!-- Primary path: unlock with passkey if slots exist -->
        <template v-if="importStep === 'choose'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Fingerprint class="h-5 w-5" />
              {{ t('settings.identity.recoveryKey.import.chooseTitle') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.import.chooseDescription') }}
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter class="gap-2 sm:flex-col">
            <Button
              class="w-full"
              :disabled="isLoading"
              @click="handleUnlockWithPasskey"
            >
              <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
              <Fingerprint v-else class="h-4 w-4 mr-2" />
              {{ t('settings.identity.recoveryKey.import.unlockWithPasskey') }}
            </Button>
            <Button
              variant="outline"
              class="w-full"
              @click="openTransferDialog"
            >
              <Smartphone class="h-4 w-4 mr-2" />
              {{ t('settings.identity.recoveryKey.import.pairWithOtherDevice') }}
            </Button>
            <Button
              variant="ghost"
              class="w-full"
              @click="importStep = 'type-key'"
            >
              {{ t('settings.identity.recoveryKey.import.useRecoveryKeyInstead') }}
            </Button>
          </DialogFooter>
        </template>

        <!-- Fallback path: typed recovery key -->
        <template v-else-if="importStep === 'type-key'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Download class="h-5 w-5" />
              {{ t('settings.identity.recoveryKey.import.typeKeyTitle') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.import.typeKeyDescription') }}
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <div class="flex flex-col gap-2">
              <Label for="recoveryKey">{{ t('settings.identity.recoveryKey.import.recoveryKeyLabel') }}</Label>
              <Input
                id="recoveryKey"
                v-model="recoveryKeyInput"
                :placeholder="t('settings.identity.recoveryKey.import.recoveryKeyPlaceholder')"
                :disabled="isLoading"
              />
            </div>

            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter class="gap-2 sm:flex-col">
            <div class="flex w-full gap-2 justify-end">
              <Button
                v-if="hasAnyPasskeySlot"
                variant="ghost"
                @click="importStep = 'choose'"
              >
                {{ t('general.back') }}
              </Button>
              <Button variant="outline" @click="handleClose"> {{ t('general.cancel') }} </Button>
              <Button
                :disabled="!recoveryKeyInput.trim() || isLoading"
                @click="handleImport"
              >
                <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
                {{ t('settings.identity.recoveryKey.import.importAction') }}
              </Button>
            </div>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2 text-center w-full pt-2"
              @click="handleResetIdentity"
            >
              {{ t('settings.identity.recoveryKey.import.lostKeyLink') }}
            </button>
          </DialogFooter>
        </template>

        <!-- Complete -->
        <template v-else-if="importStep === 'complete'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Check class="h-5 w-5 text-forest-600" />
              {{ t('settings.identity.recoveryKey.import.completeTitle') }}
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-forest-500 text-forest-600">
              <Check class="h-4 w-4" />
              <AlertDescription>
                {{ t('settings.identity.recoveryKey.import.completeMessage') }}
                <span v-if="handle" class="block mt-1 font-mono text-xs">
                  {{ t('settings.identity.recoveryKey.complete.federationId', { handle }) }}
                </span>
              </AlertDescription>
            </Alert>
          </div>
        </template>
      </template>

      <!-- View Mode -->
      <template v-else-if="mode === 'view'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Key class="h-5 w-5" />
            {{ t('settings.identity.recoveryKey.view.title') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('settings.identity.recoveryKey.view.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-2">
          <!-- Federation ID — shown above the recovery key when the user
               has set an alias, since they're frequently looked at
               together (share-with-friend + save-for-self). -->
          <div v-if="handle" class="flex flex-col gap-1.5">
            <Label class="text-xs text-muted-foreground font-normal">
              {{ t('settings.identity.recoveryKey.view.federationIdLabel') }}
            </Label>
            <div class="flex gap-2 items-stretch">
              <Code
                class="flex-1 px-3 py-2 text-sm font-mono flex items-center gap-2"
              >
                <AtSign class="h-4 w-4 text-muted-foreground shrink-0" />
                {{ handle }}
              </Code>
              <CopyButton :text="handle" variant="outline" />
            </div>
          </div>

          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>{{ t('settings.identity.recoveryKey.view.keepSecretTitle') }}</AlertTitle>
            <AlertDescription>
              {{ t('settings.identity.recoveryKey.view.keepSecretDescription') }}
            </AlertDescription>
          </Alert>

          <div class="flex flex-col gap-1.5">
            <Label class="text-xs text-muted-foreground font-normal">
              {{ t('settings.identity.recoveryKey.view.keyLabel') }}
            </Label>
            <Code
              class="p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all"
            >
              {{ formattedKey || t('general.loading') }}
            </Code>
            <Button
              v-if="existingRecoveryKey"
              variant="outline"
              class="self-start mt-1"
              @click="copyRecoveryKey"
            >
              <component
                :is="recoveryCopied ? Check : Copy"
                class="h-4 w-4 mr-2"
                :class="recoveryCopied ? 'text-forest-600' : ''"
              />
              {{ recoveryCopied ? t('settings.identity.recoveryKey.view.copied') : t('settings.identity.recoveryKey.view.copyToClipboard') }}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button @click="handleClose">{{ t('general.done') }}</Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>

  <!-- Nested transfer-identity dialog for the "Transfer from another device" import option -->
  <TransferIdentityDialog
    v-model:open="showTransferDialog"
    initial-mode="receive"
    @complete="handleTransferComplete"
  />
</template>
