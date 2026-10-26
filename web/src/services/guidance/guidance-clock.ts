// Wall clock for timetable checks, which the dev simulator can move forward.
let offsetMs = 0

export const guidanceClock = {
  now: () => Date.now() + offsetMs,
  advance(ms: number) {
    offsetMs += ms
  },
  reset() {
    offsetMs = 0
  },
}
