import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useMangroveStore } from '@/stores/mangrove.store'
import { SOURCE } from '@/lib/constants'
import { useCanReviewPlace } from './useCanReviewPlace'
import {
  deleteOwnReview,
  fetchOwnReview,
  isExpiredSession,
  saveReview,
  signIn as signInWithSigner,
  type MangroveProvider,
  type MangroveSession,
  type OwnReview,
  type ReviewInput,
} from '@/services/place/mangrove-review.service'
import type { Place } from '@/types/place.types'

export class SessionRequiredError extends Error {
  constructor() {
    super('Sign in to Mangrove to continue')
  }
}

/** The person's Mangrove review of a place, and the means to change it. */
export function useMangroveReview(place: Ref<Partial<Place>>) {
  const mangroveStore = useMangroveStore()
  const { subject, signerClientId, canReview } = useCanReviewPlace(place)

  const ownReview = shallowRef<OwnReview | null>(null)
  const saving = ref(false)
  const signingIn = ref(false)
  let signInAbort: AbortController | null = null

  const hasSession = computed(() => !!mangroveStore.activeSession)

  async function refresh() {
    ownReview.value = null
    const sub = subject.value
    const author = mangroveStore.session
    if (!canReview.value || !sub || !author) return
    try {
      const review = await fetchOwnReview(author, sub)
      if (sub === subject.value) ownReview.value = review
    } catch (error) {
      console.error('Failed to load own Mangrove review', error)
    }
  }

  watch(
    [subject, canReview, () => mangroveStore.session?.publicKey],
    refresh,
    { immediate: true },
  )

  async function signIn(provider: MangroveProvider) {
    signInAbort?.abort()
    signInAbort = new AbortController()
    signingIn.value = true
    try {
      mangroveStore.setSession(
        await signInWithSigner(signerClientId.value!, provider, signInAbort.signal),
      )
    } finally {
      signingIn.value = false
      signInAbort = null
    }
  }

  function cancelSignIn() {
    signInAbort?.abort()
  }

  onScopeDispose(cancelSignIn)

  /** Runs a signed action, dropping the session if the signer has expired it. */
  async function withSession<T>(action: (session: MangroveSession) => Promise<T>) {
    const session = mangroveStore.activeSession
    if (!session) throw new SessionRequiredError()
    saving.value = true
    try {
      return await action(session)
    } catch (error) {
      if (isExpiredSession(error)) {
        mangroveStore.expireSession()
        throw new SessionRequiredError()
      }
      throw error
    } finally {
      saving.value = false
    }
  }

  async function save(input: Omit<ReviewInput, 'osmId'>) {
    await withSession((session) =>
      saveReview(
        session,
        subject.value!,
        { ...input, osmId: place.value.externalIds?.[SOURCE.OSM] },
        ownReview.value,
      ),
    )
    await refresh()
  }

  async function remove() {
    const review = ownReview.value
    if (!review) return
    await withSession((session) => deleteOwnReview(session, review.signature))
    ownReview.value = null
  }

  return {
    canReview,
    hasSession,
    ownReview,
    saving,
    signingIn,
    signIn,
    cancelSignIn,
    save,
    remove,
  }
}
