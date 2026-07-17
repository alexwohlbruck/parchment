import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  WeatherCapability,
  WeatherData,
} from '../../types/integration.types'

export interface OpenWeatherMapConfig extends IntegrationConfig {
  apiKey: string
}

/**
 * OpenWeatherMap integration for weather data
 * Implements One Call API 3.0
 */
export class OpenWeatherMapIntegration implements Integration<OpenWeatherMapConfig> {
  private initialized = false
  private readonly WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather'

  readonly integrationId = IntegrationId.OPENWEATHERMAP
  readonly capabilityIds: IntegrationCapabilityId[] = [
    IntegrationCapabilityId.WEATHER,
  ]
  readonly capabilities = {
    weather: {
      getWeather: this.getWeather.bind(this),
    } as WeatherCapability,
  }

  protected config: OpenWeatherMapConfig = {
    apiKey: '',
  }

  /**
   * Initialize the integration with configuration
   * @param config Configuration for the integration
   */
  initialize(config: OpenWeatherMapConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: API Key is required')
    }

    this.config = {
      apiKey: config.apiKey,
    }

    this.initialized = true
  }

  /**
   * Ensures the integration has been initialized before performing operations
   * @throws Error if the integration has not been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  /**
   * Tests the connection with the given configuration
   * @param config The configuration to test
   * @returns A test result indicating success or failure
   */
  async testConnection(config: OpenWeatherMapConfig): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: API Key is required',
      }
    }

    try {
      // Test the API key with a simple current weather request for London
      // Using the simpler current weather API which is always available
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=51.5074&lon=-0.1278&appid=${config.apiKey}&units=metric`

      const response = await fetch(url)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (response.status === 401) {
          return {
            success: false,
            message: errorData.message || 'Invalid API key',
          }
        }
        return {
          success: false,
          message: errorData.message || `API error: ${response.statusText}`,
        }
      }

      return { success: true }
    } catch (error: any) {
      console.error('Error testing OpenWeatherMap API:', error)
      return {
        success: false,
        message: error.message || 'Failed to connect to OpenWeatherMap API',
      }
    }
  }

  /**
   * Get current weather data for a location
   * @param lat Latitude
   * @param lng Longitude
   * @param lang Language code (e.g., 'en', 'es', 'fr') - defaults to 'en'
   * @returns Weather data
   */
  async getWeather(lat: number, lng: number, lang?: string): Promise<WeatherData> {
    this.ensureInitialized()

    try {
      // Map common language codes to OpenWeatherMap format
      const languageCode = lang || 'en'
      
      // Fetch weather data using Current Weather API 2.5 (free tier)
      const weatherUrl = `${this.WEATHER_URL}?lat=${lat}&lon=${lng}&appid=${this.config.apiKey}&units=metric&lang=${languageCode}`
      const weatherResponse = await fetch(weatherUrl)

      if (!weatherResponse.ok) {
        const errorData = await weatherResponse.json().catch(() => ({}))
        throw new Error(errorData.message || `Weather API error: ${weatherResponse.statusText}`)
      }

      const weatherData = await weatherResponse.json()

      // NOTE: Air quality is intentionally NOT sourced here. The weather
      // controller attaches it solely from a real OpenAQ ground station — we do
      // not fall back to OpenWeatherMap's modeled AQI (a wrong number is worse
      // than none), so there's no air-pollution fetch or computation here.

      // Transform the response to our WeatherData format
      // Current Weather API 2.5 has a different structure than One Call API
      const weather = weatherData.weather[0]
      const main = weatherData.main
      const wind = weatherData.wind
      const sys = weatherData.sys

      const result: WeatherData = {
        locationName: weatherData.name || undefined,
        temperature: Math.round(main.temp),
        temperatureFeelsLike: Math.round(main.feels_like),
        temperatureMin: main.temp_min ? Math.round(main.temp_min) : undefined,
        temperatureMax: main.temp_max ? Math.round(main.temp_max) : undefined,
        humidity: main.humidity,
        pressure: main.pressure,
        windSpeed: wind.speed,
        windDirection: wind.deg,
        cloudiness: weatherData.clouds?.all,
        visibility: weatherData.visibility,
        condition: weather.main,
        conditionDescription: weather.description,
        conditionIcon: weather.icon,
        timestamp: new Date(weatherData.dt * 1000).toISOString(),
        sunrise: sys.sunrise ? new Date(sys.sunrise * 1000).toISOString() : undefined,
        sunset: sys.sunset ? new Date(sys.sunset * 1000).toISOString() : undefined,
      }

      return result
    } catch (error: any) {
      console.error('Error fetching weather data:', error)
      throw new Error(error.message || 'Failed to fetch weather data')
    }
  }

  /**
   * Validates that the configuration has all required fields
   * @param config The configuration to validate
   * @returns True if the configuration is valid, false otherwise
   */
  validateConfig(config: OpenWeatherMapConfig): boolean {
    return Boolean(config && config.apiKey)
  }
}
