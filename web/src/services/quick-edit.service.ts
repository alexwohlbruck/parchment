import { api } from '@/lib/api'
import type {
  DuplicateCandidate,
  EditablePreset,
  GeometryType,
  OsmEdit,
  OsmLiveElement,
  OsmElementType,
  PresetSearchResult,
  SubmitEditInput,
  SubmitEditResult,
} from '@/types/quick-edit.types'

export function useQuickEditService() {
  async function searchPresets(
    q: string,
    geometry?: GeometryType,
  ): Promise<PresetSearchResult[]> {
    const response = await api.get<{ results: PresetSearchResult[] }>(
      '/osm/presets/search',
      { params: { q, geometry } },
    )
    return response.data.results
  }

  async function getPreset(id: string): Promise<EditablePreset> {
    const response = await api.get<EditablePreset>(`/osm/presets/${id}`)
    return response.data
  }

  async function getElement(
    type: OsmElementType,
    id: string | number,
  ): Promise<{ element: OsmLiveElement; preset: EditablePreset | null }> {
    const response = await api.get<{
      element: OsmLiveElement
      preset: EditablePreset | null
    }>(`/osm/element/${type}/${id}`)
    return response.data
  }

  async function findDuplicates(
    lat: number,
    lng: number,
    presetId: string,
  ): Promise<DuplicateCandidate[]> {
    const response = await api.get<{ results: DuplicateCandidate[] }>(
      '/osm/duplicates',
      { params: { lat, lng, presetId } },
    )
    return response.data.results
  }

  async function submitEdit(input: SubmitEditInput): Promise<SubmitEditResult> {
    const response = await api.post<SubmitEditResult>('/osm/edits', input)
    return response.data
  }

  async function getPendingEdits(element?: {
    type: string
    id: string
  }): Promise<OsmEdit[]> {
    const response = await api.get<{ edits: OsmEdit[] }>('/osm/edits', {
      params: element ? { osmType: element.type, osmId: element.id } : {},
    })
    return response.data.edits
  }

  async function getOsmServer(): Promise<{ server: string; serverUrl: string } | null> {
    try {
      const response = await api.get<{ server: string; serverUrl: string }>(
        '/osm/config',
      )
      return response.data
    } catch {
      return null
    }
  }

  return {
    searchPresets,
    getPreset,
    getElement,
    findDuplicates,
    submitEdit,
    getPendingEdits,
    getOsmServer,
  }
}
