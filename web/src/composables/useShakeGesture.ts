import { ref, readonly, onUnmounted, getCurrentInstance } from 'vue'

/**
 * iOS 13+ gates motion behind a permission that can only be requested from a
 * user gesture, so `requestPermission` doubles as the feature detect for it.
 */
interface DeviceMotionEventiOSConstructor {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export type MotionPermissionState =
  | 'unsupported'
  | 'prompt'
  | 'granted'
  | 'denied'

/** Total g-force above rest that counts as a shake rather than a bump. */
const SHAKE_THRESHOLD = 22

/** A shake is several jolts; sample no faster than this between them. */
const SAMPLE_INTERVAL_MS = 120

/** Jolts within the window needed to fire, so a single knock does nothing. */
const REQUIRED_JOLTS = 3
const JOLT_WINDOW_MS = 1000

/** Quiet period after firing, so one shake doesn't fire twice. */
const COOLDOWN_MS = 2500

/**
 * Detect a deliberate device shake. Deliberately conservative: a shake has to
 * be several hard jolts in quick succession, because the cost of a false
 * positive (a dialog over the map while walking) is much higher than the cost
 * of the user shaking again.
 */
export function useShakeGesture(onShake: () => void) {
  const isSupported =
    typeof window !== 'undefined' && 'DeviceMotionEvent' in window

  const permissionState = ref<MotionPermissionState>(
    isSupported ? 'prompt' : 'unsupported',
  )
  const isListening = ref(false)

  let lastSample = 0
  let lastX = 0
  let lastY = 0
  let lastZ = 0
  let jolts: number[] = []
  let cooldownUntil = 0

  function handleMotion(event: DeviceMotionEvent) {
    // Prefer the gravity-inclusive reading: shaking a phone that is lying flat
    // barely registers on accelerationIncludingGravity's peers.
    const acceleration =
      event.accelerationIncludingGravity ?? event.acceleration
    if (!acceleration) return

    const now = Date.now()
    if (now < cooldownUntil) return
    if (now - lastSample < SAMPLE_INTERVAL_MS) return

    // The spec types these as nullable, and defaults don't cover null.
    const x = acceleration.x ?? 0
    const y = acceleration.y ?? 0
    const z = acceleration.z ?? 0

    // First reading only establishes a baseline — there is nothing to compare.
    if (lastSample !== 0) {
      const delta =
        Math.abs(x - lastX) + Math.abs(y - lastY) + Math.abs(z - lastZ)

      if (delta > SHAKE_THRESHOLD) {
        jolts.push(now)
        jolts = jolts.filter(t => now - t < JOLT_WINDOW_MS)

        if (jolts.length >= REQUIRED_JOLTS) {
          jolts = []
          cooldownUntil = now + COOLDOWN_MS
          onShake()
        }
      }
    }

    lastSample = now
    lastX = x
    lastY = y
    lastZ = z
  }

  function start() {
    if (!isSupported || isListening.value) return
    window.addEventListener('devicemotion', handleMotion)
    isListening.value = true
  }

  function stop() {
    if (!isListening.value) return
    window.removeEventListener('devicemotion', handleMotion)
    isListening.value = false
    lastSample = 0
    jolts = []
  }

  /**
   * Must be called from a user gesture on iOS or the browser rejects it —
   * the settings toggle is that gesture.
   */
  async function requestPermission(): Promise<MotionPermissionState> {
    if (!isSupported) {
      permissionState.value = 'unsupported'
      return permissionState.value
    }

    const DeviceMotion =
      window.DeviceMotionEvent as unknown as DeviceMotionEventiOSConstructor

    if (typeof DeviceMotion.requestPermission !== 'function') {
      // No permission model here — listening is enough.
      permissionState.value = 'granted'
      start()
      return permissionState.value
    }

    try {
      const result = await DeviceMotion.requestPermission()
      permissionState.value = result === 'granted' ? 'granted' : 'denied'
      if (result === 'granted') start()
    } catch {
      // Thrown when not called from a user gesture — stay at 'prompt' so a
      // later gesture can retry.
      permissionState.value = 'prompt'
    }

    return permissionState.value
  }

  /** True when starting needs no permission prompt. */
  function canStartWithoutPrompt(): boolean {
    if (!isSupported) return false
    const DeviceMotion =
      window.DeviceMotionEvent as unknown as DeviceMotionEventiOSConstructor
    return typeof DeviceMotion.requestPermission !== 'function'
  }

  // Usable outside a component (tests, stores), where there is no instance to
  // hook — callers there stop it themselves.
  if (getCurrentInstance()) onUnmounted(stop)

  return {
    isSupported,
    permissionState: readonly(permissionState),
    isListening: readonly(isListening),
    start,
    stop,
    requestPermission,
    canStartWithoutPrompt,
  }
}
