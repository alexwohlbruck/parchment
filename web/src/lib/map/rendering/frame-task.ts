export function frameTask(create: () => Generator<void>, budget = 4) {
  let frame = 0
  let work: Generator<void> | null = null
  let pending = false

  function advance() {
    frame = 0
    if (!work) {
      pending = false
      work = create()
    }
    const until = performance.now() + budget
    try {
      do {
        if (work.next().done) {
          work = null
          if (pending) request()
          return
        }
      } while (performance.now() < until)
      frame = requestAnimationFrame(advance)
    } catch (error) {
      work = null
      if (pending) request()
      throw error
    }
  }

  function request() {
    pending = true
    if (!frame && !work) frame = requestAnimationFrame(advance)
  }

  function cancel() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    work?.return(undefined)
    work = null
    pending = false
  }

  return { request, cancel }
}
