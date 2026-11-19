/** Runs `task` now and then every `intervalMs()`; `retime` picks up a new interval mid-run. */
export function createPoller(task: () => void, intervalMs: () => number) {
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function schedule() {
    stop()
    timer = setInterval(task, intervalMs())
  }

  return {
    start() {
      task()
      schedule()
    },
    stop,
    retime() {
      if (timer) schedule()
    },
  }
}
