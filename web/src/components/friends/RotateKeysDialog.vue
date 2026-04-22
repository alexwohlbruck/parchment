<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdentityStore } from '@/stores/identity.store'
import type { RotationPhase } from '@/lib/km-rotation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { AlertTriangle, Check, RefreshCw, Fingerprint } from 'lucide-vue-next'

interface Props {
  open: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const identityStore = useIdentityStore()

type UiStep = 'confirm' | 'running' | 'done' | 'error'

const step = ref<UiStep>('confirm')
const phase = ref<RotationPhase | null>(null)
const error = ref<string | null>(null)
const slotWarnings = ref<string[]>([])

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 'confirm'
      phase.value = null
      error.value = null
      slotWarnings.value = []
    }
  },
)

const progressMessage = computed(() => {
  const p = phase.value
  if (!p) return 'Preparing…'
  switch (p.kind) {
    case 'starting':
      return 'Starting rotation…'
    case 'listing-data':
      return 'Listing your encrypted data…'
    case 'reencrypt-blob':
      return `Re-encrypting ${p.blobType} (${p.index}/${p.total})`
    case 'reencrypt-collection':
      return `Re-encrypting collection ${p.index} of ${p.total}`
    case 'resealing-slot':
      return `Tap your passkey to re-secure slot ${p.index} of ${p.total}`
    case 'committing':
      return 'Finalizing — saving everything at once…'
    case 'storing-seed':
      return 'Updating this device…'
    case 'done':
      return `Done — now on key version ${p.newKmVersion}`
  }
})

async function handleConfirm() {
  step.value = 'running'
  error.value = null
  slotWarnings.value = []
  phase.value = { kind: 'starting' }

  const result = await identityStore.rotateKeys({
    onProgress: (p) => {
      phase.value = p
    },
  })

  if (result.success) {
    if (result.slotResults) {
      for (const s of result.slotResults) {
        if (!s.ok) {
          slotWarnings.value.push(
            `Passkey ${s.credentialId.slice(0, 8)}… was not re-secured (${s.reason ?? 'unknown'}). It will no longer work for recovery — remove and re-add it.`,
          )
        }
      }
    }
    step.value = 'done'
  } else {
    error.value = result.error ?? 'Rotation failed'
    step.value = 'error'
  }
}

function handleClose() {
  isOpen.value = false
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <template v-if="step === 'confirm'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <RefreshCw class="h-5 w-5" />
            Rotate all keys
          </DialogTitle>
          <DialogDescription>
            This generates a new master key and re-encrypts everything under
            it. You'll need to tap each registered passkey once to re-secure
            it against the new key.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>Keep this tab open</AlertTitle>
            <AlertDescription>
              The rotation won't corrupt your data if it fails — it's
              all-or-nothing on the server. But any passkey you don't tap
              before finishing won't work for recovery afterward, so have at
              least one passkey or your recovery key ready.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="handleClose">Cancel</Button>
          <Button variant="destructive" @click="handleConfirm">
            <RefreshCw class="h-4 w-4 mr-2" />
            Rotate keys
          </Button>
        </DialogFooter>
      </template>

      <template v-else-if="step === 'running'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Spinner class="h-5 w-5" />
            Rotating keys
          </DialogTitle>
          <DialogDescription>
            Don't close this tab. We'll let you know when it's safe to
            continue.
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <div class="flex items-center gap-3 text-sm">
            <Fingerprint
              v-if="phase?.kind === 'resealing-slot'"
              class="h-5 w-5"
            />
            <Spinner v-else class="h-5 w-5" />
            <span>{{ progressMessage }}</span>
          </div>
        </div>
      </template>

      <template v-else-if="step === 'done'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Check class="h-5 w-5 text-green-600" />
            Keys rotated
          </DialogTitle>
          <DialogDescription>
            Your data has been re-encrypted under a new master key.
          </DialogDescription>
        </DialogHeader>

        <div v-if="slotWarnings.length" class="flex flex-col gap-2 py-4">
          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>Some passkeys were not re-secured</AlertTitle>
            <AlertDescription>
              <ul class="list-disc pl-4 space-y-1 text-xs">
                <li v-for="(w, i) in slotWarnings" :key="i">{{ w }}</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button @click="handleClose">Done</Button>
        </DialogFooter>
      </template>

      <template v-else-if="step === 'error'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <AlertTriangle class="h-5 w-5 text-destructive" />
            Rotation failed
          </DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <Alert variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button @click="handleClose">Close</Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
