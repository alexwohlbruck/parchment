import axios, { AxiosError } from 'axios'
import type {
  ValhallaRouteRequest,
  ValhallaRouteResponse,
} from '../types/valhalla.types.ts'

export const valhallaApi = axios.create({
  baseURL: process.env.VALHALLA_ORIGIN || 'http://valhalla:8002',
  withCredentials: true,
})

// TODO: Create integration for Valhalla routing, remove this file

export const getRoute = async (
  payload: ValhallaRouteRequest,
): Promise<ValhallaRouteResponse> => {
  try {
    const response = await valhallaApi.post<ValhallaRouteResponse>(
      '/route',
      payload,
    )

    return response.data
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(`Valhalla routing error: ${error.message}`)
    }
    throw error
  }
}
