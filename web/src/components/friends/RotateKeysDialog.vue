<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
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
  if (!p) return t('friends.rotateKeys.progress.preparing')
  switch (p.kind) {
    case 'starting':
      return t('friends.rotateKeys.progress.starting')
    case 'listing-data':
      return t('friends.rotateKeys.progress.listing')
    case 'reencrypt-blob':
      return t('friends.rotateKeys.progress.reencryptBlob', {
        type: p.blobType,
        index: p.index,
        total: p.total,
      })
    case 'reencrypt-collection':
      return t('friends.rotateKeys.progress.reencryptCollection', {
        index: p.index,
        total: p.total,
      })
    case 'resealing-slot':
      return t('friends.rotateKeys.progress.resealingSlot', {
        index: p.index,
        total: p.total,
      })
    case 'committing':
      return t('friends.rotateKeys.progress.committing')
    case 'storing-seed':
      return t('friends.rotateKeys.progress.storingSeed')
    case 'done':
      return t('friends.rotateKeys.progress.done', { version: p.newKmVersion })
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
            t('friends.rotateKeys.slotWarning', {
              id: s.credentialId.slice(0, 8),
              reason: s.reason ?? t('friends.rotateKeys.unknownReason'),
            }),
          )
        }
      }
    }
    step.value = 'done'
  } else {
    error.value = result.error ?? t('friends.rotateKeys.failedFallback')
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
            {{ t('friends.rotateKeys.title') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('friends.rotateKeys.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-3 py-2">
          <p class="text-sm text-muted-foreground">
            {{ t('friends.rotateKeys.subDescription') }}
          </p>

          <!-- Warning, not destructive — this is a pre-action caveat,
               not an error. The red destructive button still signals
               severity for the action itself. -->
          <Alert variant="warning">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>{{ t('friends.rotateKeys.beforeYouContinue') }}</AlertTitle>
            <AlertDescription>
              <ul class="list-disc pl-4 space-y-1 text-xs mt-1">
                <li>{{ t('friends.rotateKeys.warning.keepOpen') }}</li>
                <li>{{ t('friends.rotateKeys.warning.tapEach') }}</li>
                <li>{{ t('friends.rotateKeys.warning.failsSafe') }}</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button variant="outline" @click="handleClose">{{ t('friends.cancel') }}</Button>
          <Button variant="destructive" @click="handleConfirm">
            <RefreshCw class="h-4 w-4 mr-2" />
            {{ t('friends.rotateKeys.action') }}
          </Button>
        </DialogFooter>
      </template>

      <template v-else-if="step === 'running'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Spinner class="h-5 w-5" />
            {{ t('friends.rotateKeys.runningTitle') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('friends.rotateKeys.runningDescription') }}
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
            {{ t('friends.rotateKeys.doneTitle') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('friends.rotateKeys.doneDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div v-if="slotWarnings.length" class="flex flex-col gap-2 py-4">
          <!-- Warning, not destructive — rotation itself succeeded;
               just some slots failed to re-secure. That's an
               actionable caveat, not a failure state. -->
          <Alert variant="warning">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>{{ t('friends.rotateKeys.notResecuredTitle') }}</AlertTitle>
            <AlertDescription>
              <ul class="list-disc pl-4 space-y-1 text-xs">
                <li v-for="(w, i) in slotWarnings" :key="i">{{ w }}</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button @click="handleClose">{{ t('friends.done') }}</Button>
        </DialogFooter>
      </template>

      <template v-else-if="step === 'error'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <AlertTriangle class="h-5 w-5 text-destructive" />
            {{ t('friends.rotateKeys.failedTitle') }}
          </DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-4">
          <Alert variant="destructive">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button @click="handleClose">{{ t('friends.rotateKeys.close') }}</Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
