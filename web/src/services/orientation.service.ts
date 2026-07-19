/**
 * Device Orientation (Compass) Service
 *
 * Reactive device compass heading, used to draw the direction beam on the
 * user-location marker. Reads the magnetometer via DeviceOrientation events:
 *
 *  - iOS Safari exposes `webkitCompassHeading` (degrees clockwise from true
 *    north) and gates the sensor behind a permission prompt that must be
 *    requested from a user gesture — see `requestPermission()`.
 *  - Chrome / Android deliver an earth-referenced frame via the
 *    `deviceorientationabsolute` event; heading is derived from `alpha` and
 *    corrected for the current screen rotation.
 *
 * `heading` stays null until a real reading arrives and on platforms with no
 * magnetometer (most desktops), so callers can hide the beam when it's
 * unavailable.
 */

import { createSharedComposable } from '@vueuse/core'
import { readonly, ref } from 'vue'

export type OrientationPermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported'

// iOS exposes compass fields on the event and a static permission gate.
interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  webkitCompassHeading?: number
  webkitCompassAccuracy?: number
}
type DeviceOrientationEventiOSConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/** Current screen rotation in degrees (0 in portrait, 90/270 in landscape). */
function screenAngle(): number {
  const orientation = window.screen?.orientation
  if (orientation && typeof orientation.angle === 'number') {
    return orientation.angle
  }
  // Legacy Safari fallback.
  return (window as unknown as { orientation?: number }).orientation ?? 0
}

function orientationService() {
  const heading = ref<number | null>(null)
  // Heading uncertainty in degrees, as reported by iOS `webkitCompassAccuracy`
  // (lower = more confident, negative = uncalibrated). `null` where the
  // platform gives no accuracy signal (Chrome/Android), so callers can fall
  // back to a default beam width.
  const headingAccuracy = ref<number | null>(null)
  const permissionState = ref<OrientationPermissionState>('prompt')
  let listening = false

  const isSupported =
    typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

  function handleEvent(event: DeviceOrientationEvent) {
    const e = event as DeviceOrientationEventiOS

    // iOS: compass heading is provided directly (deg clockwise from north).
    if (
      typeof e.webkitCompassHeading === 'number' &&
      !Number.isNaN(e.webkitCompassHeading)
    ) {
      heading.value = e.webkitCompassHeading
      headingAccuracy.value =
        typeof e.webkitCompassAccuracy === 'number'
          ? e.webkitCompassAccuracy
          : null
      return
    }

    // Others: derive from the absolute frame. `alpha` is degrees
    // counter-clockwise from north around the vertical axis; the compass
    // heading is its complement, offset by the current screen rotation.
    if (e.absolute && e.alpha != null) {
      heading.value = (360 - e.alpha + screenAngle() + 360) % 360
      // The DeviceOrientation API carries no heading-accuracy on this path.
      headingAccuracy.value = null
    }
  }

  function start() {
    if (listening || !isSupported) return
    listening = true
    // `deviceorientationabsolute` carries an earth-referenced frame on
    // Chrome / Android; iOS fires plain `deviceorientation` with
    // `webkitCompassHeading`. Listen for both.
    window.addEventListener(
      'deviceorientationabsolute',
      handleEvent as EventListener,
      true,
    )
    window.addEventListener(
      'deviceorientation',
      handleEvent as EventListener,
      true,
    )
  }

  function stop() {
    if (!listening) return
    listening = false
    window.removeEventListener(
      'deviceorientationabsolute',
      handleEvent as EventListener,
      true,
    )
    window.removeEventListener(
      'deviceorientation',
      handleEvent as EventListener,
      true,
    )
  }

  /**
   * Request compass access. On iOS this must be called from a user gesture
   * (e.g. the locate button) or the browser rejects it. Elsewhere there is no
   * permission model, so this just starts listening.
   */
  async function requestPermission(): Promise<OrientationPermissionState> {
    if (!isSupported) {
      permissionState.value = 'unsupported'
      return permissionState.value
    }

    const DeviceOrientation =
      window.DeviceOrientationEvent as DeviceOrientationEventiOSConstructor

    if (typeof DeviceOrientation.requestPermission === 'function') {
      try {
        const result = await DeviceOrientation.requestPermission()
        permissionState.value = result === 'granted' ? 'granted' : 'denied'
        if (result === 'granted') start()
      } catch {
        // Thrown when not called from a user gesture — leave as prompt so a
        // later gesture can retry.
        permissionState.value = 'prompt'
      }
    } else {
      permissionState.value = 'granted'
      start()
    }

    return permissionState.value
  }

  // Platforms without an iOS-style permission gate can listen immediately.
  if (isSupported) {
    const DeviceOrientation =
      window.DeviceOrientationEvent as DeviceOrientationEventiOSConstructor
    if (typeof DeviceOrientation.requestPermission !== 'function') {
      start()
    }
  } else {
    permissionState.value = 'unsupported'
  }

  return {
    heading: readonly(heading),
    headingAccuracy: readonly(headingAccuracy),
    permissionState: readonly(permissionState),
    isSupported,
    requestPermission,
    stop,
  }
}

export const useOrientationService = createSharedComposable(orientationService)
