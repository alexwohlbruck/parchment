import type { RouteInstruction } from '../types/unified-routing.types'

/** A GraphHopper instruction's signposting: the motorway junction's number and where the signs point. */
export function graphHopperSigns(instruction: {
  motorway_junction?: string
  street_destination?: string
  street_destination_ref?: string
}): Pick<RouteInstruction, 'exitRef' | 'destination'> {
  const destination = [instruction.street_destination_ref, instruction.street_destination].filter(Boolean).join(' ')
  return {
    ...(instruction.motorway_junction && { exitRef: instruction.motorway_junction }),
    ...(destination && { destination }),
  }
}
