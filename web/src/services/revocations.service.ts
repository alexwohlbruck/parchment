/**
 * Client-side fan-out for post-reset relationship revocations.
 *
 * When the user resets their E2EE identity, the server snapshots every
 * peer handle that had an orphaned relationship into
 * `pending_revocations` (see server/services/identity-reset.service.ts).
 * After the user re-registers a new signing key (same alias), we pull
 * that list, sign a v2 RELATIONSHIP_REVOKE envelope per peer, and hand
 * them back to the server to forward. The server never synthesizes
 * these signatures — it would amount to forging the user's intent to
 * remote peers.
 *
 * Called from `completeSetup` after the new keys land on the server
 * (so peers resolving the handle pick up the new `signingKey` and can
 * verify the signature). Also safe to re-run on sign-in as a retry in
 * case a prior flush hit a transient network failure.
 */

import { api } from '@/lib/api'
import {
  buildSignableMessageV2,
  generateNonce,
  sign as signEd25519,
} from '@/lib/federation-crypto'

interface PendingRevocationResponse {
  revocations: Array<{
    id: string
    peerHandle: string
    createdAt: string
  }>
}

interface FlushResponse {
  results: Array<{
    peerHandle: string
    delivered: boolean
    error?: string
  }>
}

export async function fetchPendingRevocations(): Promise<string[]> {
  const response = await api.get<PendingRevocationResponse>(
    '/users/me/revocations/pending',
  )
  return response.data.revocations.map((r) => r.peerHandle)
}

/**
 * Sign a batch of RELATIONSHIP_REVOKE envelopes with the caller's new
 * Ed25519 signing key and post them to the server for forwarding.
 *
 * Callers provide:
 *   - `myHandle` — the sender handle (user's alias@domain). Must match
 *     the handle the server registered the new keys under, otherwise
 *     peer-side signature verification will fail on the `from:` mismatch.
 *   - `signingPrivateKey` — the NEW key, derived from the fresh seed.
 *
 * Returns whatever the server reports back for each attempted handle:
 * which ones delivered (and were cleared) vs. which are still queued.
 */
export async function flushPendingRevocations(params: {
  myHandle: string
  signingPrivateKey: Uint8Array
  peerHandles: string[]
}): Promise<FlushResponse['results']> {
  if (params.peerHandles.length === 0) return []

  const items: Array<{
    peerHandle: string
    signature: string
    nonce: string
    timestamp: string
    messageVersion: number
  }> = []

  for (const peerHandle of params.peerHandles) {
    const nonce = generateNonce()
    const timestamp = new Date().toISOString()
    const signable = buildSignableMessageV2({
      protocol_version: 2,
      message_type: 'RELATIONSHIP_REVOKE',
      message_version: 1,
      from: params.myHandle,
      to: peerHandle,
      nonce,
      timestamp,
      payload: {},
    })
    const signature = await signEd25519(signable, params.signingPrivateKey)
    items.push({
      peerHandle,
      signature,
      nonce,
      timestamp,
      messageVersion: 1,
    })
  }

  const response = await api.post<FlushResponse>(
    '/users/me/revocations/flush',
    { items },
  )
  return response.data.results
}

/**
 * Convenience: fetch + flush in one call. Swallows errors so the caller
 * (identity setup) doesn't abort on network blips — the queue persists
 * server-side and can be retried next session.
 */
export async function flushAllPendingRevocations(params: {
  myHandle: string
  signingPrivateKey: Uint8Array
}): Promise<void> {
  try {
    const peerHandles = await fetchPendingRevocations()
    if (peerHandles.length === 0) return
    await flushPendingRevocations({ ...params, peerHandles })
  } catch (err) {
    // Non-fatal: setup should succeed even if revocation fan-out fails.
    // The user's own local state is fine; only the remote cleanup is
    // deferred to a later retry.
    console.warn('[revocations] flush failed, will retry on next setup', err)
  }
}
