import axios from 'axios'
import {
  IntegrationConfig,
  IntegrationTestResult,
  IntegrationCapabilityId,
  IntegrationId,
  Integration,
  OsmMapEditCapability,
  OsmNote,
  OsmNoteComment,
} from '../../types/integration.types'
import { SOURCE } from '../../lib/constants'
import { osmConfig } from '../../config/osm.config'

const OSM_API_BASE = osmConfig.apiBase

export interface OpenStreetMapConfig extends IntegrationConfig {
  accessToken: string
  refreshToken?: string
  tokenExpiresAt?: string
  osmUserId?: number
  osmDisplayName?: string
  osmProfileImageUrl?: string
  osmAccountCreated?: string
  osmChangesetCount?: number
  osmTraceCount?: number
}

export class OpenStreetMapIntegration
  implements Integration<OpenStreetMapConfig>
{
  private initialized = false

  readonly integrationId = IntegrationId.OPENSTREETMAP_ACCOUNT
  readonly capabilityIds = [
    IntegrationCapabilityId.OSM_MAP_EDIT,
  ]
  readonly capabilities = {
    osmMapEdit: {
      createNote: this.createNote.bind(this),
      getNote: this.getNote.bind(this),
      commentOnNote: this.commentOnNote.bind(this),
      closeNote: this.closeNote.bind(this),
      createChangeset: this.createChangeset.bind(this),
      uploadChange: this.uploadChange.bind(this),
      closeChangeset: this.closeChangeset.bind(this),
    } as OsmMapEditCapability,
  }
  readonly sources = [SOURCE.OSM]

  protected config: OpenStreetMapConfig = {
    accessToken: '',
  }

  initialize(config: OpenStreetMapConfig): void {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid configuration: access token is required')
    }
    this.config = { ...config }
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        `Integration ${this.integrationId} has not been initialized. Call initialize() first.`,
      )
    }
  }

  async testConnection(
    config: OpenStreetMapConfig,
  ): Promise<IntegrationTestResult> {
    if (!this.validateConfig(config)) {
      return {
        success: false,
        message: 'Invalid configuration: access token is required',
      }
    }

    try {
      const response = await axios.get(`${OSM_API_BASE}/user/details.json`, {
        headers: this.getAuthHeaders(config.accessToken),
      })
      const user = response.data?.user
      if (user) {
        return {
          success: true,
          message: `Connected as ${user.display_name}`,
        }
      }
      return { success: false, message: 'Unexpected response from OSM API' }
    } catch (error: any) {
      const status = error.response?.status
      if (status === 401) {
        return { success: false, message: 'Access token is invalid or expired' }
      }
      return {
        success: false,
        message: error.message || 'Failed to connect to OpenStreetMap API',
      }
    }
  }

  validateConfig(config: OpenStreetMapConfig): boolean {
    return Boolean(config && config.accessToken)
  }

  private getAuthHeaders(accessToken?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken || this.config.accessToken}`,
      Accept: 'application/json',
    }
  }

  // --- OSM Notes ---

  private async createNote(
    lat: number,
    lng: number,
    text: string,
  ): Promise<OsmNote> {
    this.ensureInitialized()
    const response = await axios.post(
      `${OSM_API_BASE}/notes.json`,
      null,
      {
        params: { lat, lon: lng, text },
        headers: this.getAuthHeaders(),
      },
    )
    return this.adaptNote(response.data.properties)
  }

  private async getNote(id: number): Promise<OsmNote> {
    this.ensureInitialized()
    const response = await axios.get(`${OSM_API_BASE}/notes/${id}.json`, {
      headers: this.getAuthHeaders(),
    })
    return this.adaptNote(response.data.properties)
  }

  private async commentOnNote(id: number, text: string): Promise<OsmNote> {
    this.ensureInitialized()
    const response = await axios.post(
      `${OSM_API_BASE}/notes/${id}/comment.json`,
      null,
      {
        params: { text },
        headers: this.getAuthHeaders(),
      },
    )
    return this.adaptNote(response.data.properties)
  }

  private async closeNote(id: number, text?: string): Promise<OsmNote> {
    this.ensureInitialized()
    const response = await axios.post(
      `${OSM_API_BASE}/notes/${id}/close.json`,
      null,
      {
        params: text ? { text } : undefined,
        headers: this.getAuthHeaders(),
      },
    )
    return this.adaptNote(response.data.properties)
  }

  // --- OSM Edit ---

  private async createChangeset(
    tags: Record<string, string>,
  ): Promise<number> {
    this.ensureInitialized()
    const tagsXml = Object.entries(tags)
      .map(([k, v]) => `<tag k="${this.escapeXml(k)}" v="${this.escapeXml(v)}"/>`)
      .join('')
    const body = `<osm><changeset>${tagsXml}</changeset></osm>`

    const response = await axios.put(`${OSM_API_BASE}/changeset/create`, body, {
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'text/xml',
      },
    })
    return parseInt(response.data, 10)
  }

  private async uploadChange(
    changesetId: number,
    osmChange: string,
  ): Promise<void> {
    this.ensureInitialized()
    await axios.post(
      `${OSM_API_BASE}/changeset/${changesetId}/upload`,
      osmChange,
      {
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'text/xml',
        },
      },
    )
  }

  private async closeChangeset(changesetId: number): Promise<void> {
    this.ensureInitialized()
    await axios.put(
      `${OSM_API_BASE}/changeset/${changesetId}/close`,
      null,
      { headers: this.getAuthHeaders() },
    )
  }

  // --- Adapters ---

  private adaptNote(props: any): OsmNote {
    return {
      id: props.id,
      lat: props.lat ?? props.geometry?.coordinates?.[1],
      lng: props.lon ?? props.geometry?.coordinates?.[0],
      status: props.status,
      comments: (props.comments || []).map(
        (c: any): OsmNoteComment => ({
          date: c.date,
          uid: c.uid,
          user: c.user,
          action: c.action,
          text: c.text,
        }),
      ),
      createdAt: props.date_created,
      closedAt: props.closed_at,
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
