import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntegrationService } from '@/services/integration.service'
import { toast } from '@/lib/toast'
import { api } from '@/lib/api'

export function useOsmConnection() {
  const { t } = useI18n()
  const integrationService = useIntegrationService()
  const connecting = ref(false)
  let oauthChannel: BroadcastChannel | null = null
  let oauthPoll: ReturnType<typeof setInterval> | undefined

  function stopListeningForOauthResult() {
    oauthChannel?.close()
    oauthChannel = null
    clearInterval(oauthPoll)
  }

  onUnmounted(stopListeningForOauthResult)

  function listenForOauthResult(popup: Window | null) {
    stopListeningForOauthResult()

    oauthChannel = new BroadcastChannel('osm-oauth')
    oauthChannel.onmessage = async ({ data }) => {
      if (data?.type !== 'osm-oauth-callback') return
      stopListeningForOauthResult()
      popup?.close()

      if (data.status === 'connected') {
        toast.success(t('settings.integrations.osm.connected'))
        await integrationService.fetchConfiguredIntegrations()
        await integrationService.fetchAvailableIntegrations()
      } else {
        toast.error(data.message || t('settings.integrations.osm.authError'))
      }
    }

    // OSM severs the opener; a closed handle does not mean authorization ended.
    oauthPoll = setInterval(() => {
      if (!popup?.closed) return
      clearInterval(oauthPoll)
      connecting.value = false
      integrationService.fetchConfiguredIntegrations()
    }, 1000)
  }

  function offerManualCallback() {
    const finish = async (redirectUrl: string) => {
      const params = new URL(redirectUrl).searchParams
      const code = params.get('code')
      const state = params.get('state')

      if (!code || !state) {
        toast.error(t('settings.integrations.osm.manualCallbackNoCode'))
        return
      }

      try {
        const { data } = await api.get('/integrations/osm/callback', {
          params: { code, state },
          headers: { Accept: 'application/json' },
        })

        if (data.status !== 'connected') {
          toast.error(data.message || t('settings.integrations.osm.authError'))
          return
        }

        delete (window as any).__osmDevCallback
        toast.success(t('settings.integrations.osm.connected'))
        await integrationService.fetchConfiguredIntegrations()
        await integrationService.fetchAvailableIntegrations()
      } catch (error: any) {
        toast.error(
          error.response?.data?.message ||
            error.message ||
            t('settings.integrations.osm.authError'), { cause: error },
        )
      }
    }

    ;(window as any).__osmDevCallback = finish

    console.log(
      '%cConnecting an OpenStreetMap account',
      'font-weight: bold; font-size: 14px;',
    )
    console.log(
      "After you authorize, OpenStreetMap sends you to this app's registered\n" +
        'redirect URI, which this deployment does not answer on — the page will\n' +
        'fail to load. Copy its full URL (it carries ?code=...&state=...) and run:\n\n' +
        "  window.__osmDevCallback('PASTE_FULL_URL_HERE')\n",
    )

    toast.info(t('settings.integrations.osm.devCallbackInstructions'))
  }

  async function connect() {
    if (connecting.value) return
    const popup = window.open('', 'osm-oauth', 'width=600,height=700,popup=yes')
    if (!popup) {
      toast.error(t('onboarding.openstreetmap.popupBlocked'))
      return
    }

    connecting.value = true
    try {
      const response = await api.get('/integrations/osm/authorize')
      const { url, manualCallback } = response.data
      if (manualCallback) {
        offerManualCallback()
      } else {
        listenForOauthResult(popup)
      }
      popup.location.href = url
    } catch (error) {
      popup.close()
      toast.error(t('settings.integrations.osm.authError'), { cause: error })
    } finally {
      connecting.value = false
    }
  }

  return { connect, connecting }
}
