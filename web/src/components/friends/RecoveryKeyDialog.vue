<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
  Download,
  AtSign,
  Fingerprint,
  Smartphone,
} from 'lucide-vue-next'
import TransferIdentityDialog from './TransferIdentityDialog.vue'

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
const error = ref<string | null>(null)
const setupStep = ref<SetupStep>('generate')
const importStep = ref<ImportStep>('choose')
const passkeyBusy = ref(false)
const showTransferDialog = ref(false)
const existingPasskeys = ref<Passkey[]>([])

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
    error.value = result.error || 'Setup failed'
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

  passkeyBusy.value = true
  error.value = null
  try {
    const result = await identityStore.enrollExistingPasskey(candidate.id)
    if (result.success && result.slotCreated) {
      setupStep.value = 'complete'
      setTimeout(() => {
        isOpen.value = false
        emit('complete')
      }, 1500)
    } else {
      // Most common reason: this authenticator didn't evaluate PRF (e.g.
      // a passkey registered by an older Chrome without the extension).
      // Leave the user on the offer step and surface the reason.
      error.value =
        result.error ??
        "This passkey can't be used for recovery. Try adding a new one."
    }
  } finally {
    passkeyBusy.value = false
  }
}

async function handleAddRecoveryPasskey() {
  const name = await appService.prompt({
    title: 'Name this passkey',
    label: 'Passkey name',
    inputProps: {
      placeholder: 'Eg. Chrome, iCloud Keychain, YubiKey',
    },
  })
  if (!name) return

  passkeyBusy.value = true
  error.value = null
  try {
    const result = await identityStore.enrollPasskey(name, {
      onSecondTapNeeded: () => {
        // Second ceremony — show the reason inline so the user doesn't
        // think the second prompt is a duplicate/error.
        error.value = null
        passkeyBusy.value = true
      },
    })
    if (result.success && result.slotCreated) {
      setupStep.value = 'complete'
      setTimeout(() => {
        isOpen.value = false
        emit('complete')
      }, 1500)
    } else {
      // Passkey may have been registered as sign-in only; surface the
      // reason but still let them finish — the recovery key path is
      // already saved.
      error.value =
        result.error ??
        'Could not enable passkey recovery. You can still finish setup using your recovery key.'
    }
  } finally {
    passkeyBusy.value = false
  }
}

function handleSkipPasskey() {
  setupStep.value = 'complete'
  setTimeout(() => {
    isOpen.value = false
    emit('complete')
  }, 1500)
}

async function handleUnlockWithPasskey() {
  error.value = null
  const result = await identityStore.unlockWithPasskey()
  if (result.success) {
    importStep.value = 'complete'
    setTimeout(() => {
      isOpen.value = false
      emit('complete')
    }, 1500)
  } else {
    error.value = result.error || 'Could not unlock with passkey'
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
    setTimeout(() => {
      isOpen.value = false
      emit('complete')
    }, 1500)
  } else {
    error.value = result.error || 'Invalid recovery key'
  }
}

async function handleResetIdentity() {
  // Two-step gate: first a destructive confirm, then a typed
  // confirmation. Skipping straight to typed-only would mean a
  // misclick could open a full-screen modal asking to erase
  // everything; the confirm dialog gives the user a chance to bail
  // before the typed prompt appears.
  const confirmed = await appService.confirm({
    title: 'Reset your account?',
    description:
      'This permanently erases all your encrypted data on this account — ' +
      'saved places, collections, friends, and sharing settings. Your ' +
      'email and passkeys stay, so you can keep signing in. This can\'t be undone.',
    destructive: true,
    continueText: 'Continue',
  })
  if (!confirmed) return

  const typed = await appService.prompt({
    title: 'Type RESET to confirm',
    label: 'Confirmation',
    inputProps: { placeholder: 'RESET' },
  })
  if (typed?.trim().toUpperCase() !== 'RESET') return

  error.value = null
  const result = await identityStore.resetIdentity()
  if (!result.success) {
    error.value = result.error ?? 'Reset failed. Please try again.'
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
              Set Up Federation Identity
            </DialogTitle>
            <DialogDescription>
              Your recovery key is your last-resort way back in if you lose
              every device. Save it somewhere safe — a password manager is
              ideal. We'll offer to set up a passkey for everyday recovery
              in the next step.
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <Alert variant="destructive">
              <AlertTriangle class="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                If you lose this key AND every passkey, you will need to
                create a new identity and re-add all your friends.
              </AlertDescription>
            </Alert>

            <div class="flex flex-col gap-2">
              <Label>Your Recovery Key</Label>
              <Code
                class="p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all"
              >
                {{ formattedKey || 'Generating...' }}
              </Code>
              <div v-if="displayedKey" class="flex gap-2">
                <CopyButton
                  :text="displayedKey"
                  variant="outline"
                  message="Recovery key copied. Paste it into your password manager."
                />
                <span class="text-xs text-muted-foreground self-center">
                  Like a master password. Keep it secret and safe.
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
                I have saved my recovery key in a secure location
              </Label>
            </div>

            <Alert v-if="error" variant="destructive">
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </div>

          <DialogFooter class="gap-2">
            <Button variant="outline" @click="handleClose"> Cancel </Button>
            <Button
              :disabled="!hasSavedKey || isLoading"
              @click="handleConfirmSetup"
            >
              <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
              Continue
            </Button>
          </DialogFooter>
        </template>

        <!-- Passkey enrollment offer -->
        <template v-else-if="setupStep === 'passkey-offer'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Fingerprint class="h-5 w-5" />
              Add a passkey for recovery?
            </DialogTitle>
            <DialogDescription>
              Passkeys let you recover your identity on a new device with a
              single tap, no recovery key required. You can always add more
              later from Settings.
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <Alert>
              <Fingerprint class="h-4 w-4" />
              <AlertDescription>
                Your recovery key is already safe. Adding a passkey is
                optional but strongly recommended.
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
                <span class="font-semibold">You already have a passkey:</span>
                <span class="ml-1 font-mono">{{ promotionCandidate.name }}</span>
              </div>
              <p class="text-xs text-muted-foreground">
                Tap it below to enable recovery on it. Some browsers or older
                passkeys can't do this — if it doesn't work, use "Add new"
                instead.
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
              Use "{{ promotionCandidate.name }}" for recovery
            </Button>
            <Button
              :variant="promotionCandidate ? 'outline' : 'default'"
              class="w-full"
              :disabled="passkeyBusy"
              @click="handleAddRecoveryPasskey"
            >
              {{ promotionCandidate ? 'Add a new passkey instead' : 'Add passkey' }}
            </Button>
            <Button
              variant="ghost"
              class="w-full"
              :disabled="passkeyBusy"
              @click="handleSkipPasskey"
            >
              Skip for now
            </Button>
          </DialogFooter>
        </template>

        <!-- Complete -->
        <template v-else-if="setupStep === 'complete'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Check class="h-5 w-5 text-green-600" />
              Identity set up
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-green-500 text-green-600">
              <Check class="h-4 w-4" />
              <AlertDescription>
                Identity set up successfully!
                <span v-if="handle" class="block mt-1 font-mono text-xs">
                  Your Federation ID: {{ handle }}
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
              Restore your identity
            </DialogTitle>
            <DialogDescription>
              Tap one of your registered passkeys to recover your identity on
              this device.
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
              Unlock with passkey
            </Button>
            <Button
              variant="outline"
              class="w-full"
              @click="openTransferDialog"
            >
              <Smartphone class="h-4 w-4 mr-2" />
              Transfer from another device
            </Button>
            <Button
              variant="ghost"
              class="w-full"
              @click="importStep = 'type-key'"
            >
              Use recovery key instead
            </Button>
          </DialogFooter>
        </template>

        <!-- Fallback path: typed recovery key -->
        <template v-else-if="importStep === 'type-key'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Download class="h-5 w-5" />
              Import Recovery Key
            </DialogTitle>
            <DialogDescription>
              Enter your recovery key to restore your identity on this device.
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-4 py-4">
            <div class="flex flex-col gap-2">
              <Label for="recoveryKey">Recovery Key</Label>
              <Input
                id="recoveryKey"
                v-model="recoveryKeyInput"
                placeholder="Paste your recovery key here"
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
                Back
              </Button>
              <Button variant="outline" @click="handleClose"> Cancel </Button>
              <Button
                :disabled="!recoveryKeyInput.trim() || isLoading"
                @click="handleImport"
              >
                <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
                Import
              </Button>
            </div>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2 text-center w-full pt-2"
              @click="handleResetIdentity"
            >
              Lost your recovery key?
            </button>
          </DialogFooter>
        </template>

        <!-- Complete -->
        <template v-else-if="importStep === 'complete'">
          <DialogHeader>
            <DialogTitle class="flex items-center gap-2">
              <Check class="h-5 w-5 text-green-600" />
              Identity restored
            </DialogTitle>
          </DialogHeader>
          <div class="flex flex-col gap-4 py-4">
            <Alert class="border-green-500 text-green-600">
              <Check class="h-4 w-4" />
              <AlertDescription>
                Identity restored successfully!
                <span v-if="handle" class="block mt-1 font-mono text-xs">
                  Your Federation ID: {{ handle }}
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
            Your Recovery Key
          </DialogTitle>
          <DialogDescription>
            This is your federation identity recovery key. Keep it safe and
            never share it with anyone.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <!-- Federation ID -->
          <div v-if="handle" class="flex flex-col gap-2">
            <Label>Your Federation ID</Label>
            <div class="flex gap-2">
              <Code
                class="flex-1 p-3 text-sm font-mono flex items-center gap-2"
              >
                <AtSign class="h-4 w-4 text-muted-foreground shrink-0" />
                {{ handle }}
              </Code>
              <CopyButton :text="handle" variant="outline" />
            </div>
            <p class="text-xs text-muted-foreground">
              Share this with friends so they can add you.
            </p>
          </div>

          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>Keep this secret</AlertTitle>
            <AlertDescription>
              Anyone with this key can sign in as you on any device.
            </AlertDescription>
          </Alert>

          <div class="flex flex-col gap-2">
            <Label>Recovery Key</Label>
            <Code
              class="p-3 text-sm font-mono whitespace-pre-wrap break-words leading-relaxed select-all"
            >
              {{ formattedKey || 'Loading...' }}
            </Code>
            <div v-if="existingRecoveryKey" class="flex gap-2">
              <CopyButton
                :text="existingRecoveryKey"
                variant="outline"
                message="Recovery key copied. Paste it into your password manager."
              />
              <span class="text-xs text-muted-foreground self-center">
                Save this in a password manager or print it — you'll need it if
                you lose every device.
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button @click="handleClose"> Done </Button>
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
