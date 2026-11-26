import axios from 'axios'
import { getOsmConfig } from '../config/osm.config'
import { APP_USER_AGENT } from '../lib/constants'
import { getConfiguredIntegrations } from './integration.service'
import { IntegrationId } from '../types/integration.types'

/** The user's OpenStreetMap access token, when they've connected their account. */
export async function osmAccountToken(userId: string): Promise<string | null> {
  const integrations = await getConfiguredIntegrations(userId)
  const osm = integrations.find((integration) => integration.integrationId === IntegrationId.OPENSTREETMAP_ACCOUNT)
  return (osm?.config as { accessToken?: string } | undefined)?.accessToken ?? null
}

/** Posts a note as the account the token belongs to, returning OSM's GeoJSON feature for it. */
export async function postOsmNote(token: string, lat: number, lng: number, text: string) {
  const { data } = await axios.post(`${getOsmConfig().apiBase}/notes.json`, null, {
    params: { lat, lon: lng, text },
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': APP_USER_AGENT },
  })
  return data
}

/** The text of every comment on the open notes in a bounding box, `west,south,east,north`. */
export async function openOsmNoteTexts(bbox: string): Promise<string[]> {
  const { data } = await axios.get(`${getOsmConfig().apiBase}/notes.json`, {
    params: { bbox, closed: 0 },
    headers: { Accept: 'application/json', 'User-Agent': APP_USER_AGENT },
  })
  return (data?.features ?? []).flatMap(
    (note: { properties?: { comments?: { text?: string }[] } }) => note.properties?.comments?.map((comment) => comment.text ?? '') ?? [],
  )
}
