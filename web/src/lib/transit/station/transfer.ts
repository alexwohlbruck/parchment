import type { StationPathSource, TransitTransfer } from '@server/types/station-guidance.types'

export type TransferKind = 'crossPlatform' | 'inStation' | 'passageway' | 'reenter'

export interface TransferSummary {
  kind: TransferKind
  seconds: number | null
  /** The time is a guess, not a walk measured on the station map. */
  estimate: boolean
  viaStreet: boolean
  /** For a change that taps out: whether the second tap is free; null when unknown. */
  reentryFree: boolean | null
}

const KINDS: Record<TransitTransfer['class'], TransferKind> = {
  same_platform: 'crossPlatform',
  in_station: 'inStation',
  in_system_passage: 'passageway',
  out_of_system: 'reenter',
}

/** A time from the station map or the agency is measured; anything else is a guess. */
export const isGuessed = (source: StationPathSource | null) => source === 'estimated' || source === 'straight_line'

export function transferSummary(transfer: TransitTransfer): TransferSummary {
  const kind = KINDS[transfer.class]
  return {
    kind,
    seconds: kind === 'crossPlatform' ? null : transfer.seconds,
    estimate: isGuessed(transfer.source),
    viaStreet: transfer.surfaces === true,
    reentryFree: kind === 'reenter' ? transfer.reentryFree : null,
  }
}
