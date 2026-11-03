// Keeps the screen on while navigating. The browser drops the lock whenever
// the page is hidden, so it is re-requested on return.

let sentinel: WakeLockSentinel | null = null
let wanted = false

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return
  try {
    sentinel = (await navigator.wakeLock?.request('screen')) ?? null
    sentinel?.addEventListener('release', () => (sentinel = null), { once: true })
  } catch {
    sentinel = null
  }
}

const onVisibilityChange = () => void acquire()

export function holdScreenAwake(): void {
  wanted = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  void acquire()
}

export function releaseScreenAwake(): void {
  wanted = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  void sentinel?.release()
  sentinel = null
}
