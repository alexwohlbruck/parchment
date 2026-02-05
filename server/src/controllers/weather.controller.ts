import { Elysia, t, error } from 'elysia'
import { integrationManager } from '../services/integrations'
import { IntegrationCapabilityId } from '../types/integration.types'

const weatherRouter = new Elysia({ prefix: '/weather' })
  /**
   * Get current weather data for a location
   * GET /weather?lat=40.7128&lng=-74.0060
   */
  .get(
    '/',
    async ({ query }) => {
      const { lat, lng } = query

      if (lat === undefined || lng === undefined) {
        return error(400, {
          message: 'Latitude and longitude are required',
        })
      }

      try {
        // Get weather integration (system-level)
        const weatherIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.WEATHER,
          )

        if (weatherIntegrations.length === 0) {
          return error(503, {
            message: 'No weather service is currently available',
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = weatherIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.weather) {
          return error(503, {
            message: 'Weather service is not properly configured',
          })
        }

        // Call the weather capability
        const weatherData = await integration.capabilities.weather.getWeather(
          Number(lat),
          Number(lng),
        )

        return weatherData
      } catch (err: any) {
        console.error('Error fetching weather:', err)
        return error(500, {
          message: err.message || 'Failed to fetch weather data',
        })
      }
    },
    {
      query: t.Object({
        lat: t.Numeric(),
        lng: t.Numeric(),
      }),
    },
  )

export default weatherRouter
