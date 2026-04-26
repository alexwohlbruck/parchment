<script setup lang="ts">
/**
 * Device-to-device identity transfer dialog.
 *
 * Two-sided flow:
 *   - RECEIVER (new device): creates a session, renders a QR with
 *     {sessionId, receiverEphemeralPub}, polls the server for the sender's
 *     sealed payload, verifies the SAS match with the user, then unseals
 *     the seed and stores it locally.
 *   - SENDER (existing device): scans the receiver's QR via camera,
 *     derives the 6-digit SAS, generates its sender-ephemeral keypair,
 *     seals the seed, uploads. Shows SAS so the user can cross-check
 *     against the new device's screen.
 *
 * The sealed payload is AES-GCM bound to both ephemeral pubs + sessionId,
 * signed with the sender's long-term Ed25519 identity key. A MITM who
 * proxies the QR cannot unseal; a MITM who swaps keys on the wire cannot
 * forge the signature.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { storeToRefs } from 'pinia'
import { api } from '@/lib/api'
import { useIdentityStore } from '@/stores/identity.store'
import { useAuthStore } from '@/stores/auth.store'
import { getSeed, storeSeed } from '@/lib/key-storage'
import {
  generateEphemeralKeypair,
  deriveSAS,
  sealSeedForTransfer,
  openTransferredSeed,
  type SealedTransferPayload,
} from '@/lib/device-transfer'
import {
  deriveAllKeys,
  importPublicKey,
  bytesToBase64,
  base64ToBytes,
} from '@/lib/federation-crypto'
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
import {
  Smartphone,
  QrCode,
  Camera,
  AlertTriangle,
  Check,
  ArrowLeft,
} from 'lucide-vue-next'

interface Props {
  open: boolean
  /**
   * If the caller is the NEW DEVICE restoring an identity, they already
   * know that's their role — pass `'receive'` to skip the chooser. From
   * Settings (sender side) we pass nothing and let the user pick.
   */
  initialMode?: 'choose' | 'receive' | 'send'
}

const props = withDefaults(defineProps<Props>(), {
  initialMode: 'choose',
})
const emit = defineEmits<{
  'update:open': [value: boolean]
  complete: []
}>()

const { t } = useI18n()
const identityStore = useIdentityStore()
const authStore = useAuthStore()
const { me } = storeToRefs(authStore)

type Mode = 'choose' | 'receive' | 'send'
type ReceiveStage =
  | 'creating'
  | 'showing-qr'
  | 'awaiting-upload'
  | 'confirm-sas'
  | 'unsealing'
  | 'done'
  | 'error'
type SendStage =
  | 'scanning'
  | 'sealing'
  | 'uploaded'
  | 'error'

const mode = ref<Mode>(props.initialMode)
const error = ref<string | null>(null)

// --- Receiver state ---
const receiveStage = ref<ReceiveStage>('creating')
const receiverKeypair = ref<{
  privateKey: Uint8Array
  publicKey: Uint8Array
} | null>(null)
const sessionId = ref<string | null>(null)
const qrDataUrl = ref<string | null>(null)
const pollingTimer = ref<number | null>(null)
const pollingDeadlineTimer = ref<number | null>(null)
const receivedPayload = ref<SealedTransferPayload | null>(null)
const computedSasReceive = ref<string | null>(null)

// Server enforces a 60s TTL on device-transfer sessions. Match that on
// the client so the receiver's polling gives up with a clear message
// instead of looping forever and eventually showing a 404.
const TRANSFER_SESSION_TTL_MS = 60_000

// --- Sender state ---
const sendStage = ref<SendStage>('scanning')
const videoEl = ref<HTMLVideoElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const mediaStream = ref<MediaStream | null>(null)
const scanRafId = ref<number | null>(null)
const computedSasSend = ref<string | null>(null)

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetAllState()
      mode.value = props.initialMode
      if (mode.value === 'receive') void startReceive()
      if (mode.value === 'send') void startSend()
    } else {
      cleanup()
    }
  },
)

onBeforeUnmount(cleanup)

function resetAllState() {
  error.value = null
  receiveStage.value = 'creating'
  receiverKeypair.value = null
  sessionId.value = null
  qrDataUrl.value = null
  receivedPayload.value = null
  computedSasReceive.value = null
  sendStage.value = 'scanning'
  computedSasSend.value = null
}

function cleanup() {
  if (pollingTimer.value !== null) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
  if (pollingDeadlineTimer.value !== null) {
    clearTimeout(pollingDeadlineTimer.value)
    pollingDeadlineTimer.value = null
  }
  if (scanRafId.value !== null) {
    cancelAnimationFrame(scanRafId.value)
    scanRafId.value = null
  }
  if (mediaStream.value) {
    for (const track of mediaStream.value.getTracks()) track.stop()
    mediaStream.value = null
  }
}

function closeDialog() {
  isOpen.value = false
}

// --------------------------------------------------------------------------
// Receiver flow
// --------------------------------------------------------------------------

async function startReceive() {
  resetAllState()
  mode.value = 'receive'
  receiveStage.value = 'creating'
  error.value = null

  try {
    const kp = generateEphemeralKeypair()
    receiverKeypair.value = kp

    const pubB64 = bytesToBase64(kp.publicKey)
    const response = await api.post<{ sessionId: string; expiresAt: string }>(
      '/device-transfer',
      { receiverEphemeralPub: pubB64 },
    )
    sessionId.value = response.data.sessionId

    const qrPayload = JSON.stringify({
      v: 1,
      sessionId: sessionId.value,
      receiverPub: pubB64,
    })
    qrDataUrl.value = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      width: 320,
      margin: 2,
    })

    receiveStage.value = 'awaiting-upload'
    startPolling()
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('settings.identity.transferDevice.errors.sessionStart')
    receiveStage.value = 'error'
  }
}

function startPolling() {
  if (pollingTimer.value !== null) clearInterval(pollingTimer.value)
  if (pollingDeadlineTimer.value !== null)
    clearTimeout(pollingDeadlineTimer.value)
  pollingTimer.value = window.setInterval(() => void pollOnce(), 2000)
  pollingDeadlineTimer.value = window.setTimeout(() => {
    // Matches the server-side session TTL. Past this point the server
    // will 404 every request; bail with a user-facing message instead
    // of spinning forever.
    if (receiveStage.value === 'awaiting-upload') {
      if (pollingTimer.value !== null) {
        clearInterval(pollingTimer.value)
        pollingTimer.value = null
      }
      error.value = t('settings.identity.transferDevice.errors.sessionExpired')
      receiveStage.value = 'error'
    }
  }, TRANSFER_SESSION_TTL_MS)
  void pollOnce()
}

async function pollOnce() {
  if (!sessionId.value) return
  try {
    const response = await api.get<{
      sessionId: string
      receiverEphemeralPub: string
      senderEphemeralPub: string | null
      sealedSeed: string | null
      senderSignature: string | null
    }>(`/device-transfer/${sessionId.value}`, {
      // 425 is the expected "payload not uploaded yet" signal during
      // polling; 404 can occur briefly between session create and the
      // server's read-after-write. Neither is user-actionable.
      silentStatuses: [404, 425],
    } as Parameters<typeof api.get>[1])

    const { senderEphemeralPub, sealedSeed, senderSignature } = response.data
    if (senderEphemeralPub && sealedSeed && senderSignature) {
      if (pollingTimer.value !== null) {
        clearInterval(pollingTimer.value)
        pollingTimer.value = null
      }
      receivedPayload.value = {
        senderEphemeralPub,
        sealedSeed,
        senderSignature,
      }
      computedSasReceive.value = deriveSAS(
        receiverKeypair.value!.publicKey,
        base64ToBytes(senderEphemeralPub),
        sessionId.value,
      )
      receiveStage.value = 'confirm-sas'
    }
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    // 425 = payload not uploaded yet (the server tells us to retry). Keep polling.
    if (status === 425) return
    if (pollingTimer.value !== null) {
      clearInterval(pollingTimer.value)
      pollingTimer.value = null
    }
    error.value =
      err instanceof Error ? err.message : t('settings.identity.transferDevice.errors.polling')
    receiveStage.value = 'error'
  }
}

async function handleConfirmSasMatches() {
  if (!receivedPayload.value || !receiverKeypair.value || !sessionId.value) {
    error.value = t('settings.identity.transferDevice.errors.missingState')
    receiveStage.value = 'error'
    return
  }

  receiveStage.value = 'unsealing'
  error.value = null

  try {
    // Verify against the server's advertised identity pubkey.
    const serverIdentity = await api.get<{ signingKey: string | null }>(
      '/users/me/identity',
    )
    if (!serverIdentity.data.signingKey) {
      throw new Error(
        t('settings.identity.transferDevice.errors.noServerIdentity'),
      )
    }
    const senderIdentityPub = importPublicKey(serverIdentity.data.signingKey)

    const seed = openTransferredSeed({
      payload: receivedPayload.value,
      receiverEphemeralPrivate: receiverKeypair.value.privateKey,
      receiverEphemeralPublic: receiverKeypair.value.publicKey,
      sessionId: sessionId.value,
      senderIdentityPublicKey: senderIdentityPub,
    })

    // Double-check: unwrapped seed's derived signing key must match the
    // server's published one. If not, something's wrong — refuse to store.
    const derived = deriveAllKeys(seed)
    const derivedPub = bytesToBase64(derived.signing.publicKey)
    if (derivedPub !== serverIdentity.data.signingKey) {
      throw new Error(
        t('settings.identity.transferDevice.errors.seedMismatch'),
      )
    }

    await storeSeed(seed)
    // Trigger identity store refresh so the UI reflects "signed in with identity".
    await identityStore.initialize()
    receiveStage.value = 'done'
    setTimeout(() => {
      emit('complete')
      closeDialog()
    }, 1500)
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('settings.identity.transferDevice.errors.openFailed')
    receiveStage.value = 'error'
  }
}

async function handleCancelTransfer() {
  if (sessionId.value) {
    try {
      await api.delete(`/device-transfer/${sessionId.value}`)
    } catch {
      // Best-effort. TTL will clean up regardless.
    }
  }
  closeDialog()
}

// --------------------------------------------------------------------------
// Sender flow
// --------------------------------------------------------------------------

async function startSend() {
  resetAllState()
  mode.value = 'send'
  sendStage.value = 'scanning'
  error.value = null

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    mediaStream.value = stream
    // Wait a tick for the video element to mount before attaching.
    await new Promise((r) => requestAnimationFrame(r))
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
      scanLoop()
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? t('settings.identity.transferDevice.errors.cameraUnavailable', { message: err.message })
        : t('settings.identity.transferDevice.errors.cameraAccess')
    sendStage.value = 'error'
  }
}

function scanLoop() {
  if (
    !videoEl.value ||
    !canvasEl.value ||
    videoEl.value.readyState < videoEl.value.HAVE_METADATA
  ) {
    scanRafId.value = requestAnimationFrame(scanLoop)
    return
  }
  const video = videoEl.value
  const canvas = canvasEl.value
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    scanRafId.value = requestAnimationFrame(scanLoop)
    return
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(imageData.data, canvas.width, canvas.height)
  if (result && result.data) {
    onScanResult(result.data)
    return
  }
  scanRafId.value = requestAnimationFrame(scanLoop)
}

async function onScanResult(raw: string) {
  // Stop the camera immediately — we're done scanning regardless of
  // whether parsing succeeds; if it fails, the user can cancel + retry.
  cleanup()

  let parsed: { v?: number; sessionId?: string; receiverPub?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    error.value = t('settings.identity.transferDevice.errors.invalidQr')
    sendStage.value = 'error'
    return
  }
  if (!parsed.sessionId || !parsed.receiverPub) {
    error.value = t('settings.identity.transferDevice.errors.missingQrData')
    sendStage.value = 'error'
    return
  }

  sendStage.value = 'sealing'
  try {
    const seed = await getSeed()
    if (!seed) {
      throw new Error(t('settings.identity.transferDevice.errors.noSeed'))
    }
    const senderKp = generateEphemeralKeypair()
    const receiverPub = base64ToBytes(parsed.receiverPub)

    // Compute SAS for display BEFORE we upload so we know what to show.
    computedSasSend.value = deriveSAS(
      receiverPub,
      senderKp.publicKey,
      parsed.sessionId,
    )

    // Use the current local seed's signing key to sign the handshake —
    // this is the sender's long-term Ed25519 identity key.
    const localKeys = deriveAllKeys(seed)
    const payload = await sealSeedForTransfer({
      seed,
      senderEphemeralPrivate: senderKp.privateKey,
      senderEphemeralPublic: senderKp.publicKey,
      receiverEphemeralPublic: receiverPub,
      sessionId: parsed.sessionId,
      senderIdentityPrivateKey: localKeys.signing.privateKey,
    })

    await api.post(`/device-transfer/${parsed.sessionId}/upload`, payload)
    sendStage.value = 'uploaded'
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : t('settings.identity.transferDevice.errors.sealUploadFailed')
    sendStage.value = 'error'
  }
}

function backToChoose() {
  cleanup()
  resetAllState()
  mode.value = 'choose'
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <!-- Chooser — framed as a question about this device's role so
           the user picks correctly the first time. The active (has
           identity) device defaults to "Send"; the blank device has
           only "Receive" available. -->
      <template v-if="mode === 'choose'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Smartphone class="h-5 w-5" />
            {{ t('settings.identity.transferDevice.choose.title') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('settings.identity.transferDevice.choose.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-2 py-2">
          <!-- "Send" FIRST when this device has the identity — it's the
               more likely action when the user is signed in here. -->
          <Button
            v-if="identityStore.hasLocalIdentity"
            variant="outline"
            class="justify-start h-auto py-3 text-left"
            @click="startSend"
          >
            <Camera class="h-5 w-5 mr-3 shrink-0" />
            <div class="flex flex-col items-start gap-0.5">
              <span class="font-semibold">{{ t('settings.identity.transferDevice.choose.currentDeviceLabel') }}</span>
              <span class="text-xs text-muted-foreground font-normal">
                {{ t('settings.identity.transferDevice.choose.currentDeviceHint') }}
              </span>
            </div>
          </Button>

          <Button
            variant="outline"
            class="justify-start h-auto py-3 text-left"
            @click="startReceive"
          >
            <QrCode class="h-5 w-5 mr-3 shrink-0" />
            <div class="flex flex-col items-start gap-0.5">
              <span class="font-semibold">{{ t('settings.identity.transferDevice.choose.newDeviceLabel') }}</span>
              <span class="text-xs text-muted-foreground font-normal">
                {{ t('settings.identity.transferDevice.choose.newDeviceHint') }}
              </span>
            </div>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" @click="closeDialog">{{ t('general.cancel') }}</Button>
        </DialogFooter>
      </template>

      <!-- Receiver -->
      <template v-else-if="mode === 'receive'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <QrCode class="h-5 w-5" />
            {{ t('settings.identity.transferDevice.receive.title') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('settings.identity.transferDevice.receive.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col items-center gap-4 py-4">
          <template v-if="receiveStage === 'creating'">
            <Spinner class="h-8 w-8" />
            <p class="text-sm text-muted-foreground">
              {{ t('settings.identity.transferDevice.receive.preparing') }}
            </p>
          </template>

          <template v-else-if="receiveStage === 'awaiting-upload' && qrDataUrl">
            <img
              :src="qrDataUrl"
              :alt="t('settings.identity.transferDevice.receive.qrAlt')"
              class="w-72 h-72 border rounded"
            />
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner class="h-4 w-4" />
              {{ t('settings.identity.transferDevice.receive.waiting') }}
            </div>
          </template>

          <template v-else-if="receiveStage === 'confirm-sas'">
            <!-- Warning: the user must cross-check the SAS against a
                 MITM attempt. Calling out "cancel if they don't match"
                 is a security-critical instruction, not a casual
                 info blurb. -->
            <Alert variant="warning">
              <AlertTitle>{{ t('settings.identity.transferDevice.receive.verifyTitle') }}</AlertTitle>
              <AlertDescription>
                {{ t('settings.identity.transferDevice.receive.verifyDescription') }}
              </AlertDescription>
            </Alert>
            <div class="text-5xl font-mono tracking-widest">
              {{ computedSasReceive }}
            </div>
          </template>

          <template v-else-if="receiveStage === 'unsealing'">
            <Spinner class="h-8 w-8" />
            <p class="text-sm text-muted-foreground">
              {{ t('settings.identity.transferDevice.receive.unsealing') }}
            </p>
          </template>

          <template v-else-if="receiveStage === 'done'">
            <Alert variant="success">
              <Check class="h-4 w-4" />
              <AlertDescription>
                {{ t('settings.identity.transferDevice.receive.doneMessage') }}
              </AlertDescription>
            </Alert>
          </template>

          <Alert v-if="error" variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button
            v-if="props.initialMode === 'choose'"
            variant="ghost"
            :icon="ArrowLeft"
            @click="backToChoose"
          >
            {{ t('general.back') }}
          </Button>
          <Button
            v-if="receiveStage === 'confirm-sas'"
            @click="handleConfirmSasMatches"
          >
            <Check class="h-4 w-4 mr-2" />
            {{ t('settings.identity.transferDevice.receive.codesMatchAction') }}
          </Button>
          <Button
            v-if="receiveStage !== 'done' && receiveStage !== 'unsealing'"
            variant="outline"
            @click="handleCancelTransfer"
          >
            {{ t('general.cancel') }}
          </Button>
        </DialogFooter>
      </template>

      <!-- Sender -->
      <template v-else-if="mode === 'send'">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Camera class="h-5 w-5" />
            {{ t('settings.identity.transferDevice.send.title') }}
          </DialogTitle>
          <DialogDescription>
            {{ t('settings.identity.transferDevice.send.description') }}
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col items-center gap-4 py-4">
          <template v-if="sendStage === 'scanning'">
            <!-- Camera preview with a dimmed overlay + transparent
                 square in the center. The square is the framing guide
                 — users aim the QR at it. Corner L-brackets show the
                 exact target bounds without obscuring the QR. -->
            <div
              class="relative w-full aspect-square bg-black rounded overflow-hidden"
            >
              <video
                ref="videoEl"
                class="w-full h-full object-cover"
                playsinline
                muted
              />
              <canvas ref="canvasEl" class="hidden" />
              <div
                class="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div
                  class="relative w-2/3 aspect-square"
                  style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);"
                >
                  <div
                    class="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-md"
                  />
                  <div
                    class="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-md"
                  />
                  <div
                    class="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-md"
                  />
                  <div
                    class="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-md"
                  />
                </div>
              </div>
            </div>
            <p class="text-sm text-muted-foreground">
              {{ t('settings.identity.transferDevice.send.viewfinderHint') }}
            </p>
          </template>

          <template v-else-if="sendStage === 'sealing'">
            <Spinner class="h-8 w-8" />
            <p class="text-sm text-muted-foreground">
              {{ t('settings.identity.transferDevice.send.sealing') }}
            </p>
          </template>

          <template v-else-if="sendStage === 'uploaded'">
            <!-- Same reasoning as the receiver: the SAS match is a
                 security-critical step, so warning (amber) beats a
                 neutral info. -->
            <Alert variant="warning">
              <AlertTitle>{{ t('settings.identity.transferDevice.send.verifyTitle') }}</AlertTitle>
              <AlertDescription>
                {{ t('settings.identity.transferDevice.send.verifyDescription') }}
              </AlertDescription>
            </Alert>
            <div class="text-5xl font-mono tracking-widest">
              {{ computedSasSend }}
            </div>
          </template>

          <Alert v-if="error" variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="gap-2">
          <Button
            v-if="props.initialMode === 'choose'"
            variant="ghost"
            :icon="ArrowLeft"
            @click="backToChoose"
          >
            {{ t('general.back') }}
          </Button>
          <Button variant="outline" @click="closeDialog">
            {{ sendStage === 'uploaded' ? t('general.done') : t('general.cancel') }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
