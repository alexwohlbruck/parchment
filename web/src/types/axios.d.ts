import 'axios'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Suppress the global error toast for this request entirely. */
    silent?: boolean
    /** Suppress the global error toast for these response statuses only. */
    silentStatuses?: number[]
    /**
     * Let this request through even while the app is offline. Reads (GET)
     * are otherwise suppressed with an `OfflineRequestError` so features
     * fall back to cache instead of burning a timeout per call.
     */
    allowOffline?: boolean
    /**
     * Third-party integration this request depends on. Upstream failures
     * (502/503) flag it as degraded in settings instead of toasting;
     * a success clears the flag.
     */
    integrationId?: string
  }
}
