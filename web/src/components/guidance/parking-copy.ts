import type { ParkingDestination } from '@/lib/guidance/parking'

type Translate = (key: string, values?: Record<string, unknown>) => string

export function parkingTitle(t: Translate, { label, vehicle }: Pick<ParkingDestination, 'label' | 'vehicle'>): string {
  return label ? t(`guidance.parking.${vehicle}.near`, { place: label }) : t(`guidance.parking.${vehicle}.nearby`)
}

export const PARKING_ICONS = { car: 'SquareParkingIcon', bike: 'BikeIcon' } as const
