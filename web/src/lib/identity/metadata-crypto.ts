/**
 * Metadata encryption helpers.
 *
 * Small, opinionated wrapper around `crypto-envelope` for the common case of
 * "encrypt a user's own metadata field (name, device label, sharing
 * preferences) at rest under their personal metadata key."
 *
 * The personal metadata key is derived from the user's seed via
 * `deriveMetadataKey` (HKDF context `parchment-metadata-v1`). Because only
 * the user has the seed, a server-side DB breach yields ciphertexts the
 * attacker can't decrypt — even for fields like first/last name that used
 * to sit in plaintext columns.
 *
 * Every call is AAD-bound. The AAD includes:
 *   - userId:     owner of the record (the user themselves here)
 *   - recordType: "user-metadata" (distinguishes from other metadata contexts)
 *   - recordId:   the field name ("first_name", "last_name", …) — makes
 *                 cross-field confusion impossible
 *   - keyContext: parchment-metadata-v1 (matches the HKDF label)
 *
 * This module is tiny on purpose — the real work lives in crypto-envelope.
 */

import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from './crypto-envelope'
import { deriveMetadataKey } from './federation-crypto'

const METADATA_KEY_CONTEXT = 'parchment-metadata-v1'

function buildMetadataAAD(params: {
  userId: string
  fieldName: string
}): AAD {
  return {
    userId: params.userId,
    recordType: 'user-metadata',
    recordId: params.fieldName,
    keyContext: METADATA_KEY_CONTEXT,
  }
}

/**
 * Encrypt a single user-metadata string under the user's metadata key.
 * Returns a base64-encoded v2 envelope suitable for storage in a text column.
 */
export function encryptMetadataField(params: {
  plaintext: string
  seed: Uint8Array
  userId: string
  fieldName: string
}): string {
  const key = deriveMetadataKey(params.seed)
  return encryptEnvelopeString({
    plaintext: params.plaintext,
    key,
    aad: buildMetadataAAD({
      userId: params.userId,
      fieldName: params.fieldName,
    }),
  })
}

/**
 * Decrypt a metadata field encrypted by encryptMetadataField. Throws on AAD
 * mismatch, wrong key, or tampered envelope.
 */
export function decryptMetadataField(params: {
  envelope: string
  seed: Uint8Array
  userId: string
  fieldName: string
}): string {
  const key = deriveMetadataKey(params.seed)
  return decryptEnvelopeString({
    envelope: params.envelope,
    key,
    aad: buildMetadataAAD({
      userId: params.userId,
      fieldName: params.fieldName,
    }),
  })
}

/**
 * Safe wrapper for display paths: returns null (not "[decrypt failed]") when
 * the envelope is missing, empty, or can't be decrypted. The calling
 * component renders a fallback (alias, blank, etc.).
 */
export function tryDecryptMetadataField(params: {
  envelope: string | null | undefined
  seed: Uint8Array | null
  userId: string
  fieldName: string
}): string | null {
  if (!params.envelope || !params.seed) return null
  try {
    return decryptMetadataField({
      envelope: params.envelope,
      seed: params.seed,
      userId: params.userId,
      fieldName: params.fieldName,
    })
  } catch {
    return null
  }
}
