import { api } from '@/lib/api'
import { Place } from '@/types/place.types'

export interface ForwardGeocodeParams {
  query: string
  lat?: number
  lng?: number
  limit?: number
}

export interface ReverseGeocodeParams {
  lat: number
  lng: number
  limit?: number
}

export interface GeocodeResponse {
  results: Place[]
  count: number
  integration: string
}

export interface ForwardGeocodeResponse extends GeocodeResponse {
  query: string
}

export interface ReverseGeocodeResponse extends GeocodeResponse {
  coordinates: {
    lat: number
    lng: number
  }
}

/**
 * Forward geocode an address to coordinates
 */
export async function forwardGeocode(
  params: ForwardGeocodeParams,
): Promise<ForwardGeocodeResponse> {
  const response = await api.get<ForwardGeocodeResponse>('/geocoding/forward', {
    params: {
      query: params.query,
      lat: params.lat,
      lng: params.lng,
      limit: params.limit || 10,
    },
  })
  return response.data
}

/**
 * Reverse geocode coordinates to an address
 */
export async function reverseGeocode(
  params: ReverseGeocodeParams,
): Promise<ReverseGeocodeResponse> {
  const response = await api.get<ReverseGeocodeResponse>('/geocoding/reverse', {
    params: {
      lat: params.lat,
      lng: params.lng,
      limit: params.limit || 10,
    },
  })
  return response.data
}

/**
 * Composable for geocoding functionality
 */
export function useGeocodingService() {
  return {
    forwardGeocode,
    reverseGeocode,
  }
}
