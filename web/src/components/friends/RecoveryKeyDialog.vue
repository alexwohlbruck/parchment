<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import type { Passkey } from '@/types/auth.types'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'
import {
  Key,
  AlertTriangle,
  Check,
  Copy,
  Download,
  AtSign,
  Fingerprint,
  Smartphone,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import TransferIdentityDialog from './TransferIdentityDialog.vue'
import {
  useBusyOperation,
  useDialogCompletion,
} from '@/composables/useDialogCompletion'

type Mode = 'setup' | 'import' | 'view'
type SetupStep =
  | 'generate'
  | 'confirm'
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
const authService = useAuthService()
const { pendingRecoveryKey, isLoading, handle, hasAnyPasskeySlot } =
  storeToRefs(identityStore)

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const recoveryKeyInput = ref('')
const existingRecoveryKey = ref<string | null>(null)
const hasSavedKey = ref(false)
const recoveryCopied = ref(false)
let recoveryCopiedTimeout: ReturnType<typeof setTimeout> | null = null
const error = ref<string | null>(null)
const setupStep = ref<SetupStep>('generate')
const importStep = ref<ImportStep>('choose')
const passkeyBusy = ref(false)
const showTransferDialog = ref(false)
const existingPasskeys = ref<Passkey[]>([])

// Short hold-open + emit('complete') after a successful step so the
// celebratory frame is visible before the dialog dismisses.
const dismissWithCompletion = useDialogCompletion(isOpen, emit)
// Wraps a passkey ceremony in the busy + error lifecycle. See composable.
const runPasskeyBusy = useBusyOperation(passkeyBusy, error)

// The first passkey without a recovery slot — the candidate we'd try to
// "promote" via a PRF assertion. `undefined` means the user has none
// registered yet, so the only way forward is to Add a new one.
const promotionCandidate = computed(() => {
  return existingPasskeys.value.find(
    (p) => !identityStore.passkeySlotCredentialIds.has(p.id),
  )
})

function openTransferDialog() {
  showTransferDialog.value = true
}

function handleTransferComplete() {
  // Transfer installed the seed locally; close the import dialog.
  isOpen.value = false
  emit('complete')
}

// For setup mode, start key generation when dialog opens
watch(
  () => props.open,
  async open => {
    if (open && props.mode === 'setup') {
      setupStep.value = 'generate'
      hasSavedKey.value = false
      error.value = null
      await identityStore.startSetup()
    } else if (open && props.mode === 'view') {
      existingRecoveryKey.value = await identityStore.fetchRecoveryKey()
    } else if (open && props.mode === 'import') {
      importStep.value = 'choose'
      error.value = null
      recoveryKeyInput.value = ''
      await identityStore.refreshSlotAvailability()
      // If the server has no slots at all, there's no point in offering
      // the passkey path — jump straight to the typed-key input.
      if (!hasAnyPasskeySlot.value) importStep.value = 'type-key'
    }
  },
)

const displayedKey = computed(() => {
  if (props.mode === 'view') return existingRecoveryKey.value
  return pendingRecoveryKey.value
})

// Chunk the base64 key into groups of 5 for human readability when
// copying it off-screen or typing it into another device. The raw
// (un-chunked) value is what gets copied to the clipboard.
const formattedKey = computed(() => {
  const k = displayedKey.value
  if (!k) return ''
  return k.match(/.{1,5}/g)?.join(' ') ?? k
})

async function handleConfirmSetup() {
  if (!hasSavedKey.value) return

  error.value = null
  const result = await identityStore.completeSetup()

  if (result.success) {
    // After the core identity is persisted, offer passkey enrollment.
    // Skipping is always valid — the recovery key is already saved.
    setupStep.value = 'passkey-offer'
    // Fire-and-forget: discover whether the user has any pre-existing
    // passkey we could light up for recovery, so the offer step can
    // present "Use your existing passkey" as the primary action.
    void refreshExistingPasskeyList()
  } else {
    error.value = result.error || t('settings.identity.recoveryKey.setup.failedFallback')
  }
}

async function refreshExistingPasskeyList() {
  try {
    const [list] = await Promise.all([
      authService.getPasskeys(),
      identityStore.refreshSlotAvailability(),
    ])
    existingPasskeys.value = list ?? []
  } catch {
    existingPasskeys.value = []
  }
}

async function handleUseExistingPasskey() {
  const candidate = promotionCandidate.value
  if (!candidate) return

  await runPasskeyBusy(async () => {
    const result = await identityStore.enrollExistingPasskey(candidate.id)
    if (result.cancelled) {
      // User cancelled the biometric prompt — stay on this step so
      // they can retry. No inline error (they know they cancelled).
      return
    }
    if (result.success && result.slotCreated) {
      setupStep.value = 'complete'
      dismissWithCompletion()
    } else {
      // Most common reason: this authenticator didn't evaluate PRF (e.g.
      // a passkey registered by an older Chrome without the extension).
      // Leave the user on the offer step and surface the reason.
      error.value =
        result.error ??
        t('settings.identity.recoveryKey.passkeyOffer.cannotUseError')
    }
  })
}

async function handleAddRecoveryPasskey() {
  // No name prompt — server auto-names from AAGUID (iCloud Keychain,
  // 1Password, …) or falls back to "{OS} · {Browser}".
  await runPasskeyBusy(async () => {
    const result = await identityStore.enrollPasskey('', {
      onSecondTapNeeded: () => {
        // Second ceremony — show the reason inline so the user doesn't
        // think the second prompt is a duplicate/error.
        error.value = null
        passkeyBusy.value = true
      },
    })
    if (result.cancelled) {
      // User cancelled. Stay on this step so they can retry with a
      // different passkey or skip to recovery-key only.
      return
    }
    if (result.success && result.slotCreated) {
      setupStep.value = 'complete'
      dismissWithCompletion()
    } else {
      // Passkey may have been registered as sign-in only; surface the
      // reason but still let them finish — the recovery key path is
      // already saved.
      error.value =
        result.error ??
        t('settings.identity.recoveryKey.passkeyOffer.enableFailedError')
    }
  })
}

function handleSkipPasskey() {
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
  // Two-step gate: first a destructive confirm, then a typed
  // confirmation. Skipping straight to typed-only would mean a
  // misclick could open a full-screen modal asking to erase
  // everything; the confirm dialog gives the user a chance to bail
  // before the typed prompt appears.
  const confirmed = await appService.confirm({
    title: t('settings.identity.recoveryKey.reset.confirmTitle'),
    description: t('settings.identity.recoveryKey.reset.confirmDescription'),
    destructive: true,
    continueText: t('general.continue'),
  })
  if (!confirmed) return

  const typed = await appService.prompt({
    title: t('settings.identity.recoveryKey.reset.typePromptTitle'),
    label: t('settings.identity.recoveryKey.reset.typePromptLabel'),
    inputProps: { placeholder: 'RESET' },
  })
  if (typed?.trim().toUpperCase() !== 'RESET') return

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
  hasSavedKey.value = false
}

// Copy the recovery key with an inline button-state change (Copy →
// Copied) on top of the existing toast. The inline feedback matters
// because "did it actually copy?" anxiety is highest for a one-time
// backup secret.
async function copyRecoveryKey() {
  if (!existingRecoveryKey.value) return
  await navigator.clipboard.writeText(existingRecoveryKey.value)
  toast.success(t('settings.identity.recoveryKey.setup.keyCopiedToast'))
  recoveryCopied.value = true
  if (recoveryCopiedTimeout) clearTimeout(recoveryCopiedTimeout)
  recoveryCopiedTimeout = setTimeout(() => {
    recoveryCopied.value = false
  }, 2000)
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <!-- Setup Mode -->
      <template v-if="mode === 'setup'">
        <!-- Main recovery-key display + confirm step -->
        <template
          v-if="setupStep === 'generate' || setupStep === 'confirm'"
        >
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Key class="h-5 w-5" />
              {{ t('settings.identity.recoveryKey.setup.title') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.setup.description') }}
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <!-- Warning, not destructive — this is a heads-up about a
                 future consequence if the user loses everything, not
                 an error state or imminent danger. -->
            <Alert variant="warning">
              <AlertTriangle class="h-4 w-4" />
              <AlertTitle>{{ t('settings.identity.recoveryKey.setup.importantTitle') }}</AlertTitle>
              <AlertDescription>
                {{ t('settings.identity.recoveryKey.setup.importantDescription') }}
              </AlertDescription>
            </Alert>

            <div class="flex flex-col gap-2">
              <Label>{{ t('settings.identity.recoveryKey.setup.keyLabel') }}</Label>
              <Code
                class="p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all"
              >
                {{ formattedKey || t('settings.identity.recoveryKey.setup.generating') }}
              </Code>
              <div v-if="displayedKey" class="flex gap-2">
                <CopyButton
                  :text="displayedKey"
                  variant="outline"
                  :message="t('settings.identity.recoveryKey.setup.keyCopiedToast')"
                />
                <span class="text-xs text-muted-foreground self-center">
                  {{ t('settings.identity.recoveryKey.setup.masterPasswordHint') }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Checkbox
                id="saved"
                v-model="hasSavedKey"
                :disabled="!displayedKey"
              />
              <Label for="saved" class="text-sm cursor-pointer">
                {{ t('settings.identity.recoveryKey.setup.confirmSavedLabel') }}
              </Label>
            </div>

            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter class="gap-2">
            <Button variant="outline" @click="handleClose"> {{ t('general.cancel') }} </Button>
            <Button
              :disabled="!hasSavedKey || isLoading"
              @click="handleConfirmSetup"
            >
              <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
              {{ t('general.continue') }}
            </Button>
          </DialogFooter>
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

          <div class="flex flex-col gap-4 py-4">
            <Alert>
              <Fingerprint class="h-4 w-4" />
              <AlertDescription>
                {{ t('settings.identity.recoveryKey.passkeyOffer.alertDescription') }}
              </AlertDescription>
            </Alert>

            <!-- If the user already has a passkey registered (typical for
                 anyone who signed in with passkey), offer to light that
                 one up as a recovery slot — one tap, no new passkey. -->
            <div
              v-if="promotionCandidate"
              class="rounded-md border p-3 flex flex-col gap-2"
            >
              <div class="text-sm">
                <span class="font-semibold">{{ t('settings.identity.recoveryKey.passkeyOffer.existingLabel') }}</span>
                <span class="ml-1 font-mono">{{ promotionCandidate.name }}</span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.identity.recoveryKey.passkeyOffer.existingHint') }}
              </p>
            </div>

            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter class="gap-2 sm:flex-col">
            <Button
              v-if="promotionCandidate"
              class="w-full"
              :disabled="passkeyBusy"
              @click="handleUseExistingPasskey"
            >
              <Spinner v-if="passkeyBusy" class="h-4 w-4 mr-2" />
              <Fingerprint v-else class="h-4 w-4 mr-2" />
              {{ t('settings.identity.recoveryKey.passkeyOffer.useExisting', { name: promotionCandidate.name }) }}
            </Button>
            <Button
              :variant="promotionCandidate ? 'outline' : 'default'"
              class="w-full"
              :disabled="passkeyBusy"
              @click="handleAddRecoveryPasskey"
            >
              {{ promotionCandidate ? t('settings.identity.recoveryKey.passkeyOffer.addNewInstead') : t('settings.identity.recoveryKey.passkeyOffer.addPasskey') }}
            </Button>
            <Button
              variant="ghost"
              class="w-full"
              :disabled="passkeyBusy"
              @click="handleSkipPasskey"
            >
              {{ t('settings.identity.recoveryKey.passkeyOffer.skipForNow') }}
            </Button>
          </DialogFooter>
        </template>

        <!-- Complete -->
        <template v-else-if="setupStep === 'complete'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Check class="h-5 w-5 text-green-600" />
              {{ t('settings.identity.recoveryKey.complete.title') }}
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-green-500 text-green-600">
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
              <Check class="h-5 w-5 text-green-600" />
              {{ t('settings.identity.recoveryKey.import.completeTitle') }}
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-green-500 text-green-600">
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
                :class="recoveryCopied ? 'text-green-600' : ''"
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
