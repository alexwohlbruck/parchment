import type { Component } from 'vue'
import {
  ArrowUpDown,
  ChevronsDown,
  ChevronsUp,
  Footprints,
  LogIn,
  LogOut,
  MoveDownRight,
  MoveUpRight,
  Ticket,
  TrainFront,
  TrainFrontTunnel,
} from 'lucide-vue-next'
import type { GuidanceStep } from '@server/types/station-guidance.types'

const down = (step: Pick<GuidanceStep, 'levelChange'>) => (step.levelChange ?? 0) < 0

export function stationStepIcon(step: Pick<GuidanceStep, 'type' | 'levelChange'>): Component {
  switch (step.type) {
    case 'stairs':
      return down(step) ? ChevronsDown : ChevronsUp
    case 'escalator':
      return down(step) ? MoveDownRight : MoveUpRight
    case 'elevator':
      return ArrowUpDown
    case 'fare_gate':
      return Ticket
    case 'enter':
      return LogIn
    case 'exit':
      return LogOut
    case 'platform':
      return TrainFrontTunnel
    case 'board':
      return TrainFront
    default:
      return Footprints
  }
}
