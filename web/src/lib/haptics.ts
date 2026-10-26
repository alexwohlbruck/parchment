import { impactFeedback } from '@tauri-apps/plugin-haptics'

const VIBRATION_MS = { light: 10, medium: 20, heavy: 35 } as const

/** A tap felt on the device: Tauri's haptics on native, a short vibration elsewhere. */
export async function hapticImpact(style: keyof typeof VIBRATION_MS = 'medium'): Promise<void> {
  try {
    await impactFeedback(style)
  } catch {
    navigator.vibrate?.(VIBRATION_MS[style])
  }
}
