import { useAskStore } from '@/stores/ask.store'
import { useAuthStore } from '@/stores/auth.store'
import { useRecentsStore } from '@/stores/recents.store'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'
import { askThreads, isThreadExpired, savedThread } from '@/lib/ask/ask-threads'
import type { AskThread } from '@/types/ask.types'

/** Ask threads kept on the account, end-to-end encrypted, for as long as the user chose. */
export function useAskHistoryService() {
  const askStore = useAskStore()
  const authStore = useAuthStore()
  const askPreferences = useAskPreferencesStore()
  const recentsStore = useRecentsStore()

  const userId = () => authStore.me?.id ?? null

  function publish(id: string) {
    const { keepDays } = askPreferences.preferences
    const now = Date.now()
    askThreads.retain(thread => !isThreadExpired(thread, keepDays, now), id)
    askStore.threads = askThreads.list()
  }

  async function load(): Promise<AskThread[]> {
    const id = userId()
    if (!id) return []
    await askThreads.hydrate(id).catch(() => null)
    publish(id)
    return askStore.threads
  }

  /** Saves the open thread after an answer, when history is on. */
  function record() {
    const id = userId()
    const threadId = askStore.threadId
    if (!id || !threadId || !askPreferences.preferences.saveHistory) return
    const thread = savedThread(
      { id: threadId, createdAt: askStore.threadCreatedAt, exchanges: askStore.exchanges },
      Date.now(),
    )
    if (!thread) return
    askThreads.record(thread, id)
    if (thread.exchanges.length === 1) recentsStore.recordAskSearch(thread.title, thread.id)
    publish(id)
  }

  function find(threadId: string): AskThread | undefined {
    return askStore.threads.find(thread => thread.id === threadId)
  }

  function remove(threadId: string) {
    const id = userId()
    if (!id) return
    askThreads.retain(thread => thread.id !== threadId, id)
    recentsStore.forgetAskSearches(threadId)
    publish(id)
  }

  async function clear() {
    const id = userId()
    if (!id) return
    await askThreads.clear(id)
    recentsStore.forgetAskSearches()
    askStore.threads = []
  }

  return { load, record, find, remove, clear }
}
