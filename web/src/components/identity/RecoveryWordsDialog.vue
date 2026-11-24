<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { useAppService } from '@/services/app.service'
import type { RecoveryImportResult } from '@/services/identity.service'
import { toast } from '@/lib/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'
import {
  Key,
  KeyRound,
  Check,
  AtSign,
  Fingerprint,
  Smartphone,
  AlertTriangle,
} from 'lucide-vue-next'

import RecoveryWordsSetupContent from './RecoveryWordsSetupContent.vue'
import PasskeyOfferContent from './PasskeyOfferContent.vue'
import TransferIdentityDialog from './TransferIdentityDialog.vue'
import { useDialogCompletion } from '@/composables/useDialogCompletion'
import RecoveryWordsDisplay from './RecoveryWordsDisplay.vue'
import RecoveryWordCheck from './RecoveryWordCheck.vue'
import ResetVerifyStep from './ResetVerifyStep.vue'

type Mode = 'setup' | 'import' | 'view'
type SetupStep =
  | 'generate'
  | 'passkey-offer'
  | 'complete'
type ImportStep = 'choose' | 'type-key' | 'reset-verify' | 'complete'

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
const { isLoading, handle, hasAnyPasskeySlot, hasSavedRecoveryWords } =
  storeToRefs(identityStore)

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const recoveryWordsInput = ref('')
const existingRecoveryWords = ref<string[] | null>(null)
const checkingWords = ref(false)
const wordsChecked = ref(false)
const error = ref<string | null>(null)
const setupStep = ref<SetupStep>('generate')
const importStep = ref<ImportStep>('choose')
const showTransferDialog = ref(false)
const recoveryWordsSetupRef = ref<InstanceType<typeof RecoveryWordsSetupContent> | null>(null)

const dismissWithCompletion = useDialogCompletion(isOpen, emit)

function showTypeKeyStep() {
  error.value = null
  importStep.value = 'type-key'
}

function showChooseStep() {
  error.value = null
  importStep.value = 'choose'
}

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
      checkingWords.value = false
      wordsChecked.value = false
      existingRecoveryWords.value = await identityStore.fetchRecoveryWords()
    } else if (open && props.mode === 'import') {
      importStep.value = 'choose'
      error.value = null
      recoveryWordsInput.value = ''
      await identityStore.refreshSlotAvailability()
      if (!hasAnyPasskeySlot.value) importStep.value = 'type-key'
    }
  },
)

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
  if (!recoveryWordsInput.value.trim()) return

  error.value = null
  const result = await identityStore.importFromRecoveryWords(
    recoveryWordsInput.value,
  )

  if (result.success) {
    importStep.value = 'complete'
    dismissWithCompletion()
  } else {
    error.value = importError(result)
  }
}

function importError({ problem, word }: RecoveryImportResult) {
  switch (problem) {
    case 'unknown-word':
      return t('settings.identity.recoveryKey.import.unknownWord', { word })
    case 'word-count':
      return t('settings.identity.recoveryKey.import.wordCount')
    case 'checksum':
      return t('settings.identity.recoveryKey.import.wrongOrder')
    default:
      return t('settings.identity.recoveryKey.import.invalidKey')
  }
}

function confirmWordsSaved() {
  identityStore.markRecoveryWordsSaved()
  toast.success(t('settings.identity.recoveryKey.check.savedToast'))
  handleClose()
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
  importStep.value = 'reset-verify'
}

function handleResetComplete() {
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
  recoveryWordsInput.value = ''
  error.value = null
  setupStep.value = 'generate'
  importStep.value = 'choose'
  recoveryWordsSetupRef.value?.reset()
}

</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md" :compact="mode === 'import'">
      <!-- Setup Mode -->
      <template v-if="mode === 'setup'">
        <!-- Recovery words display + confirm step -->
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
            <RecoveryWordsSetupContent
              ref="recoveryWordsSetupRef"
              @confirm="handleSetupConfirm"
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
        <template v-if="importStep === 'choose'">
          <DialogHeader class="items-center sm:text-center">
            <div class="flex size-11 items-center justify-center rounded-full bg-muted">
              <Fingerprint class="size-5 text-muted-foreground" />
            </div>
            <DialogTitle>
              {{ t('settings.identity.recoveryKey.import.chooseTitle') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.import.chooseDescription') }}
            </DialogDescription>
          </DialogHeader>

          <p v-if="error" class="text-sm text-destructive text-center">{{ error }}</p>

          <div class="flex flex-col gap-2">
            <Button
              class="w-full"
              :disabled="isLoading"
              @click="handleUnlockWithPasskey"
            >
              <Spinner v-if="isLoading" class="size-4 mr-2" />
              <Fingerprint v-else class="size-4 mr-2" />
              {{ t('settings.identity.recoveryKey.import.unlockWithPasskey') }}
            </Button>
            <Button variant="outline" class="w-full" @click="openTransferDialog">
              <Smartphone class="size-4 mr-2" />
              {{ t('settings.identity.recoveryKey.import.pairWithOtherDevice') }}
            </Button>
            <Button variant="ghost" class="w-full" @click="showTypeKeyStep">
              {{ t('settings.identity.recoveryKey.import.useRecoveryKeyInstead') }}
            </Button>
          </div>
        </template>

        <form
          v-else-if="importStep === 'type-key'"
          class="flex flex-col gap-5"
          @submit.prevent="handleImport"
        >
          <DialogHeader class="items-center sm:text-center">
            <div class="flex size-11 items-center justify-center rounded-full bg-muted">
              <KeyRound class="size-5 text-muted-foreground" />
            </div>
            <DialogTitle>
              {{ t('settings.identity.recoveryKey.import.typeKeyTitle') }}
            </DialogTitle>
            <DialogDescription>
              {{ t('settings.identity.recoveryKey.import.typeKeyDescription') }}
            </DialogDescription>
          </DialogHeader>

          <div class="flex flex-col gap-1.5">
            <Textarea
              v-model="recoveryWordsInput"
              rows="4"
              :aria-label="t('settings.identity.recoveryKey.import.recoveryKeyLabel')"
              :aria-invalid="!!error"
              :placeholder="t('settings.identity.recoveryKey.import.recoveryKeyPlaceholder')"
              :readonly="isLoading"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              class="min-h-0 resize-none font-mono text-sm placeholder:font-sans"
              :class="error && 'border-destructive focus-visible:ring-destructive'"
              @input="error = null"
              @keydown.enter.exact.prevent="handleImport"
            />
            <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
          </div>

          <Button
            type="submit"
            class="w-full"
            :disabled="!recoveryWordsInput.trim() || isLoading"
          >
            <Spinner v-if="isLoading" class="size-4 mr-2" />
            {{ t('settings.identity.recoveryKey.import.importAction') }}
          </Button>

          <div class="flex justify-center gap-5 text-sm text-muted-foreground">
            <button
              v-if="hasAnyPasskeySlot"
              type="button"
              class="hover:text-foreground"
              @click="showChooseStep"
            >
              {{ t('settings.identity.recoveryKey.import.usePasskeyInstead') }}
            </button>
            <button
              type="button"
              class="hover:text-destructive"
              @click="handleResetIdentity"
            >
              {{ t('settings.identity.recoveryKey.import.lostKeyLink') }}
            </button>
          </div>
        </form>

        <ResetVerifyStep
          v-else-if="importStep === 'reset-verify'"
          @reset="handleResetComplete"
        />

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
            {{ t(hasSavedRecoveryWords === false ? 'settings.identity.recoveryKey.view.descriptionUnsaved' : 'settings.identity.recoveryKey.view.description') }}
          </DialogDescription>
        </DialogHeader>

        <div v-if="checkingWords && existingRecoveryWords" class="flex flex-col gap-4 py-2">
          <RecoveryWordCheck v-model:passed="wordsChecked" :words="existingRecoveryWords" />
          <button type="button" class="self-start text-sm text-muted-foreground hover:text-foreground" @click="checkingWords = false">
            {{ t('settings.identity.recoveryKey.check.showAgain') }}
          </button>
        </div>

        <div v-else class="flex flex-col gap-4 py-2">
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

          <RecoveryWordsDisplay :recovery-words="existingRecoveryWords" />
        </div>

        <DialogFooter>
          <Button v-if="checkingWords" :disabled="!wordsChecked" @click="confirmWordsSaved">
            {{ t('general.done') }}
          </Button>
          <Button v-else-if="hasSavedRecoveryWords === false && existingRecoveryWords" @click="checkingWords = true">
            {{ t('settings.identity.recoveryKey.check.start') }}
          </Button>
          <Button v-else @click="handleClose">{{ t('general.done') }}</Button>
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
