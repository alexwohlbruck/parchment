import { Elysia, t } from 'elysia'
import { integrationManager } from '../services/integrations'
import { IntegrationCapabilityId } from '../types/integration.types'
import { getLanguageCode } from '../lib/i18n'
import { getNearestStationAirQuality } from '../services/air-quality.service'
import { logError, logWarn } from '../lib/logger'

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

        // Air quality comes ONLY from a real OpenAQ ground station — never from
        // the modeled estimate (a wrong number is worse than none). When no
        // station is available (or OpenAQ is unreachable), we leave air quality
        // off and the widget simply omits it.
        try {
          const nearest = await getNearestStationAirQuality(
            Number(lat),
            Number(lng),
          )
          if (nearest) {
            weatherData.airQuality = nearest.airQuality
            weatherData.aqiComponents = nearest.components
          }
        } catch (e) {
          logWarn('OpenAQ lookup failed; omitting air quality', e)
        }

        return weatherData
      } catch (err: any) {
        logError('Error fetching weather', err)
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
