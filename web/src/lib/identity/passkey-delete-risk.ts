export type PasskeyDeleteRisk = 'sign-in' | 'unlock' | 'last-unlock'

/**
 * What deleting a passkey costs beyond sign-in: `unlock` when it can also
 * unlock encrypted data on a new device, `last-unlock` when nothing else is
 * known to — no other such passkey, and no recovery words confirmed saved.
 */
export function passkeyDeleteRisk(
  credentialId: string,
  unlockCredentialIds: ReadonlySet<string>,
  hasSavedRecoveryWords: boolean | undefined,
): PasskeyDeleteRisk {
  if (!unlockCredentialIds.has(credentialId)) return 'sign-in'
  return unlockCredentialIds.size === 1 && !hasSavedRecoveryWords ? 'last-unlock' : 'unlock'
}
