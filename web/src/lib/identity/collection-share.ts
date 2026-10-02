/**
 * What a collection's owner hands one friend, sealed so only that friend can
 * open it. A private collection's envelope carries its key: the metadata and
 * every point are sealed with that key, so it is all a recipient needs.
 */
import {
  base64ToBytes,
  bytesToBase64,
  decryptFromFriend,
  encryptForFriend,
  importPublicKey,
} from './federation-crypto'
import type { CollectionScheme } from '@/types/library.types'

const SHARE_CONTEXT = 'parchment-share-collection-v1'

export interface CollectionShare {
  collectionId: string
  scheme: CollectionScheme
  /** The collection key and its version; private collections only. */
  key?: Uint8Array
  keyVersion?: number
}

interface SharePayload {
  collectionId: string
  scheme: CollectionScheme
  key?: string
  keyVersion?: number
}

export function sealCollectionShare(params: {
  share: CollectionShare
  ownerPrivateKey: Uint8Array
  recipientPublicKey: Uint8Array
}): { encryptedData: string; nonce: string } {
  const { share } = params
  const payload: SharePayload = {
    collectionId: share.collectionId,
    scheme: share.scheme,
    ...(share.key
      ? { key: bytesToBase64(share.key), keyVersion: share.keyVersion ?? 1 }
      : {}),
  }
  const sealed = encryptForFriend(
    JSON.stringify(payload),
    params.ownerPrivateKey,
    params.recipientPublicKey,
    SHARE_CONTEXT,
  )
  return { encryptedData: sealed.ciphertext, nonce: sealed.nonce }
}

/** One share's envelope per recipient, as the share endpoints take them. */
export function sealForRecipients(params: {
  share: CollectionShare
  ownerPrivateKey: Uint8Array
  recipients: Array<{ recipientHandle: string; recipientEncryptionKey: string }>
  onEach?: (done: number, total: number) => void
}): Array<{ recipientHandle: string; encryptedData: string; nonce: string }> {
  return params.recipients.map((recipient, i) => {
    const sealed = sealCollectionShare({
      share: params.share,
      ownerPrivateKey: params.ownerPrivateKey,
      recipientPublicKey: importPublicKey(recipient.recipientEncryptionKey),
    })
    params.onEach?.(i + 1, params.recipients.length)
    return { recipientHandle: recipient.recipientHandle, ...sealed }
  })
}

/** Throws when the envelope wasn't sealed for this recipient by this sender. */
export function openCollectionShare(params: {
  envelope: { encryptedData: string; nonce: string }
  recipientPrivateKey: Uint8Array
  senderPublicKey: Uint8Array
}): CollectionShare {
  const payload = JSON.parse(
    decryptFromFriend(
      params.envelope.encryptedData,
      params.envelope.nonce,
      params.recipientPrivateKey,
      params.senderPublicKey,
      SHARE_CONTEXT,
    ),
  ) as SharePayload
  return {
    collectionId: payload.collectionId,
    scheme: payload.scheme,
    ...(payload.key
      ? { key: base64ToBytes(payload.key), keyVersion: payload.keyVersion ?? 1 }
      : {}),
  }
}
