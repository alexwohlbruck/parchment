export interface ShareWindow {
  enabled: boolean
  expiresAt: Date | null
}

export function isShareActive(share: ShareWindow, now = new Date()): boolean {
  return share.enabled && (share.expiresAt === null || share.expiresAt > now)
}
