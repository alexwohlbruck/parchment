/** Milliseconds of a frame every task shares: each still takes a step, so none starves. */
let budget = 4
let frame = -1
let deadline = 0

/** How long tasks may hold a frame between them: less while the camera moves and the frame is the map's to draw. */
export function setFrameTaskBudget(milliseconds: number) {
  budget = milliseconds
}

/** Work that runs a few steps a frame until done; a request made while it runs starts one more pass after it. */
export function frameTask(create: () => Generator<void>) {
  let handle = 0
  let work: Generator<void> | null = null
  let pending = false

  function advance(time: number) {
    handle = 0
    if (!work) {
      pending = false
      work = create()
    }
    if (time !== frame) {
      frame = time
      deadline = performance.now() + budget
    }
    try {
      do {
        if (work.next().done) {
          work = null
          if (pending) request()
          return
        }
      } while (performance.now() < deadline)
      handle = requestAnimationFrame(advance)
    } catch (error) {
      work = null
      if (pending) request()
      throw error
    }
  }

  function request() {
    pending = true
    if (!handle && !work) handle = requestAnimationFrame(advance)
  }

  function cancel() {
    if (handle) cancelAnimationFrame(handle)
    handle = 0
    work?.return(undefined)
    work = null
    pending = false
  }

  return { request, cancel }
}
