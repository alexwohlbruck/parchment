import { Elysia, t } from 'elysia'
import { integrationManager } from '../services/integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { getLanguageCode } from '../lib/i18n'
import { getNearestStationAirQuality } from '../services/air-quality.service'

const weatherRouter = new Elysia({ prefix: '/weather' })
  /**
   * Get current weather data for a location
   * GET /weather?lat=40.7128&lng=-74.0060
   */
  .get(
    '/',
    async ({ query, t, i18n, status }) => {
      const { lat, lng, lang } = query
      const language = lang ?? getLanguageCode(i18n.language)

      if (lat === undefined || lng === undefined) {
        return status(400, {
          message: t('errors.weather.locationRequired'),
        })
      }

      try {
        // Get weather integration (system-level)
        const weatherIntegrations =
          integrationManager.getConfiguredIntegrationsByCapability(
            IntegrationCapabilityId.WEATHER,
          )

        if (weatherIntegrations.length === 0) {
          return status(503, {
            message: t('errors.integration.unavailable'),
          })
        }

        // Use the first (highest priority) integration
        const integrationRecord = weatherIntegrations[0]
        const integration =
          integrationManager.getCachedIntegrationInstance(integrationRecord)

        if (!integration || !integration.capabilities.weather) {
          return status(503, {
            message: t('errors.integration.unavailable'),
          })
        }

        // Call the weather capability (always metric; lang for descriptions)
        const weatherData = await integration.capabilities.weather.getWeather(
          Number(lat),
          Number(lng),
          language,
        )

        // Prefer a real ground-sensor reading (OpenAQ) over the modeled AQI
        // when a monitoring station is nearby; otherwise keep the model value.
        try {
          const nearest = await getNearestStationAirQuality(
            Number(lat),
            Number(lng),
          )
          if (nearest) {
            weatherData.airQuality = nearest.airQuality
            weatherData.aqiComponents = {
              ...weatherData.aqiComponents,
              ...nearest.components,
            }
          }
        } catch (e) {
          console.warn('OpenAQ lookup failed; using modeled AQI:', e)
        }

        return weatherData
      } catch (err: any) {
        console.error('Error fetching weather:', err)
        return status(500, {
          message: err.message || t('errors.weather.fetchFailed'),
        })
      }
    },
    {
      query: t.Object({
        lat: t.Numeric(),
        lng: t.Numeric(),
        lang: t.Optional(t.String()),
      }),
    },
  )

export default weatherRouter
