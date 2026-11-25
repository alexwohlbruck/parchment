/** MapLibre parses tiles on one worker outside Safari; half the cores, 2 to 4, keeps every source from queuing behind the others. */
export function tileWorkerCount(cores: number | undefined): number {
  return Math.max(2, Math.min(4, Math.floor((cores || 2) / 2)))
}
