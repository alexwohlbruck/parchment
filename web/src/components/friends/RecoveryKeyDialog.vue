<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
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
import { Key, AlertTriangle, Check, Download, AtSign } from 'lucide-vue-next'

type Mode = 'setup' | 'import' | 'view'

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
const { pendingRecoveryKey, isLoading, handle } = storeToRefs(identityStore)

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const recoveryKeyInput = ref('')
const existingRecoveryKey = ref<string | null>(null)
const hasSavedKey = ref(false)
const error = ref<string | null>(null)
const step = ref<'generate' | 'confirm' | 'complete'>('generate')

// For setup mode, start key generation when dialog opens
watch(
  () => props.open,
  async open => {
    if (open && props.mode === 'setup') {
      step.value = 'generate'
      hasSavedKey.value = false
      error.value = null
      await identityStore.startSetup()
    } else if (open && props.mode === 'view') {
      existingRecoveryKey.value = await identityStore.fetchRecoveryKey()
    }
  },
)

const displayedKey = computed(() => {
  if (props.mode === 'view') return existingRecoveryKey.value
  return pendingRecoveryKey.value
})

async function handleConfirmSetup() {
  if (!hasSavedKey.value) return

  error.value = null
  const result = await identityStore.completeSetup()

  if (result.success) {
    step.value = 'complete'
    setTimeout(() => {
      isOpen.value = false
      emit('complete')
    }, 1500)
  } else {
    error.value = result.error || 'Setup failed'
  }
}

async function handleImport() {
  if (!recoveryKeyInput.value.trim()) return

  error.value = null
  const result = await identityStore.importFromRecoveryKey(
    recoveryKeyInput.value,
  )

  if (result.success) {
    step.value = 'complete'
    setTimeout(() => {
      isOpen.value = false
      emit('complete')
    }, 1500)
  } else {
    error.value = result.error || 'Invalid recovery key'
  }
}

function handleClose() {
  if (props.mode === 'setup' && step.value !== 'complete') {
    identityStore.cancelSetup()
  }
  isOpen.value = false
  recoveryKeyInput.value = ''
  error.value = null
  step.value = 'generate'
  hasSavedKey.value = false
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <!-- Setup Mode -->
      <template v-if="mode === 'setup'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Key class="h-5 w-5" />
            Set Up Federation Identity
          </DialogTitle>
          <DialogDescription>
            Your recovery key is used to secure your identity across devices.
            Save it somewhere safe like a password manager.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <!-- Warning -->
          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>Important</AlertTitle>
            <AlertDescription>
              If you lose this key, you will need to create a new identity and
              re-add all your friends. Store it securely!
            </AlertDescription>
          </Alert>

          <!-- Recovery Key Display -->
          <div class="flex flex-col gap-2">
            <Label>Your Recovery Key</Label>
            <div class="flex gap-2">
              <Code class="flex-1 p-3 text-sm font-mono break-all">
                {{ displayedKey || 'Generating...' }}
              </Code>
              <CopyButton
                v-if="displayedKey"
                :text="displayedKey"
                variant="outline"
              />
            </div>
            <p class="text-xs text-muted-foreground">
              This key is like a password. Keep it secret and safe.
            </p>
          </div>

          <!-- Confirmation Checkbox -->
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

          <!-- Error -->
          <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <!-- Complete -->
          <Alert
            v-if="step === 'complete'"
            class="border-green-500 text-green-600"
          >
            <Check class="h-4 w-4" />
            <AlertDescription>
              Identity set up successfully!
              <span v-if="handle" class="block mt-1 font-mono text-xs">
                Your Federation ID: {{ handle }}
              </span>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="handleClose"> Cancel </Button>
          <Button
            :disabled="!hasSavedKey || isLoading || step === 'complete'"
            @click="handleConfirmSetup"
          >
            <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
            Complete Setup
          </Button>
        </DialogFooter>
      </template>

      <!-- Import Mode -->
      <template v-else-if="mode === 'import'">
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
              :disabled="isLoading || step === 'complete'"
            />
          </div>

          <!-- Error -->
          <Alert v-if="error" variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <!-- Complete -->
          <Alert
            v-if="step === 'complete'"
            class="border-green-500 text-green-600"
          >
            <Check class="h-4 w-4" />
            <AlertDescription>
              Identity restored successfully!
              <span v-if="handle" class="block mt-1 font-mono text-xs">
                Your Federation ID: {{ handle }}
              </span>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="handleClose"> Cancel </Button>
          <Button
            :disabled="
              !recoveryKeyInput.trim() || isLoading || step === 'complete'
            "
            @click="handleImport"
          >
            <Spinner v-if="isLoading" class="h-4 w-4 mr-2" />
            Import
          </Button>
        </DialogFooter>
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
            <AlertDescription>
              Anyone with this key can impersonate your identity!
            </AlertDescription>
          </Alert>

          <div class="flex flex-col gap-2">
            <Label>Recovery Key</Label>
            <div class="flex gap-2">
              <Code class="flex-1 p-3 text-sm font-mono break-all">
                {{ existingRecoveryKey || 'Loading...' }}
              </Code>
              <CopyButton
                v-if="existingRecoveryKey"
                :text="existingRecoveryKey"
                variant="outline"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button @click="handleClose"> Done </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
