import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  checkAndPinFriend,
  getPin,
  markPinVerified,
  rotatePin,
  type PinDecision,
} from '@/lib/identity/key-pinning'
import type { Friendship } from '@/services/friends.service'

export type PinStatus = PinDecision | 'unavailable'

export interface TrustedFriendKeys {
  signingKey: string
  encryptionKey: string
}

interface PinRecord {
  keys: string
  status: PinStatus
  verified: boolean
}

function keysFingerprint(friend: Friendship): string | null {
  if (!friend.friendSigningKey || !friend.friendEncryptionKey) return null
  return `${friend.friendSigningKey}|${friend.friendEncryptionKey}`
}

/**
 * Trust-on-first-use pins for friends' public keys. Every encrypt-to or
 * verify-from a friend goes through `trustedKeys`, so a key the server
 * swapped in is never used until the user accepts it.
 */
export const useFriendKeyPinsStore = defineStore('friend-key-pins', () => {
  const records = ref<Record<string, PinRecord>>({})

  // Pins live in one encrypted blob, so read-modify-write must not interleave.
  let queue: Promise<unknown> = Promise.resolve()
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  async function check(friend: Friendship): Promise<PinStatus> {
    const fingerprint = keysFingerprint(friend)
    if (!fingerprint) return 'unavailable'
    const cached = records.value[friend.friendHandle]
    if (cached?.keys === fingerprint && cached.status !== 'unavailable') {
      return cached.status
    }

    return serial(async () => {
      let status: PinStatus
      let verified = false
      try {
        const result = await checkAndPinFriend({
          handle: friend.friendHandle,
          signingKey: friend.friendSigningKey!,
          encryptionKey: friend.friendEncryptionKey!,
        })
        status = result.action
        verified = result.pin.verified
      } catch (err) {
        console.warn('[key-pins] could not check pin for', friend.friendHandle, err)
        status = 'unavailable'
      }
      records.value[friend.friendHandle] = { keys: fingerprint, status, verified }
      return status
    })
  }

  /** The friend's keys, or null while they're unpinned-unreadable or changed. */
  async function trustedKeys(friend: Friendship): Promise<TrustedFriendKeys | null> {
    const status = await check(friend)
    if (status !== 'pinned' && status !== 'match') return null
    return {
      signingKey: friend.friendSigningKey!,
      encryptionKey: friend.friendEncryptionKey!,
    }
  }

  async function checkAll(friends: Friendship[]): Promise<void> {
    for (const friend of friends) await check(friend)
  }

  /** Adopt the friend's current keys after the user compared safety numbers. */
  async function acceptKeys(friend: Friendship): Promise<void> {
    const fingerprint = keysFingerprint(friend)
    if (!fingerprint) return
    await serial(async () => {
      await rotatePin({
        handle: friend.friendHandle,
        signingKey: friend.friendSigningKey!,
        encryptionKey: friend.friendEncryptionKey!,
      })
      await markPinVerified(friend.friendHandle)
      records.value[friend.friendHandle] = {
        keys: fingerprint,
        status: 'match',
        verified: true,
      }
    })
  }

  async function markVerified(friend: Friendship): Promise<void> {
    await serial(async () => {
      if (!(await getPin(friend.friendHandle))) return
      await markPinVerified(friend.friendHandle)
      const record = records.value[friend.friendHandle]
      if (record) record.verified = true
    })
  }

  function statusFor(handle: string): PinRecord | undefined {
    return records.value[handle]
  }

  function clear() {
    records.value = {}
  }

  return { records, check, trustedKeys, checkAll, acceptKeys, markVerified, statusFor, clear }
})
