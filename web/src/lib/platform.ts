/**
 * Whether the app is running on an Apple platform (macOS / iOS / iPadOS).
 * Used to label the platform-aware `mod` modifier as ⌘ vs Ctrl.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}
