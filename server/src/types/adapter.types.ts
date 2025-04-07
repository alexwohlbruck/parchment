import type {
  AttributedValue,
  Address,
  OpeningHours,
  PlacePhoto,
} from './unified-place.types'

export interface PlaceDataAdapter {
  sourceId: string
  sourceName: string
  sourceUrl: (data: any) => string
  transform: (data: any) => {
    name?: AttributedValue<string>
    address?: AttributedValue<Address>
    contactInfo?: {
      phone: AttributedValue<string> | null
      email: AttributedValue<string> | null
      website: AttributedValue<string> | null
      socials?: Record<string, AttributedValue<string>>
    }
    openingHours?: AttributedValue<OpeningHours>
    photos?: PlacePhoto[]
    amenities?: Record<string, AttributedValue<string>[]>
    ratings?: {
      rating: AttributedValue<number>
      reviewCount: AttributedValue<number>
    }
  }
}
