/**
 * Unit tests for layers service
 *
 * Tests cover:
 * - initializeLayers with mocked MapStrategy
 * - addLayerToMap / removeLayerFromMap
 * - Special handling for search results layer
 * - Transit stop click handlers
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useLayersService } from './layers.service'
import type { Layer } from '@/types/map.types'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'

// Mock specialized services
const mockSearchResultsService = {
  createSearchResultsLayer: vi.fn(() => ({ id: 'search-results-layer' })),
  initializeSearchResultsLayer: vi.fn(),
}

const mockTransitService = {
  addTransitStopClickHandlers: vi.fn(),
}

vi.mock('./features/search-results-layer.service', () => ({
  useSearchResultsLayerService: () => mockSearchResultsService,
}))

vi.mock('./features/transit-layers.service', () => ({
  useTransitLayersService: () => mockTransitService,
}))

vi.mock('./core/layer-crud.service', () => ({
  useLayerCrudService: () => ({
    getLayers: vi.fn(() => []),
    createLayer: vi.fn(),
    updateLayer: vi.fn(),
    deleteLayer: vi.fn(),
    getLayerGroups: vi.fn(() => []),
    createLayerGroup: vi.fn(),
    updateLayerGroup: vi.fn(),
    deleteLayerGroup: vi.fn(),
    reorderLayers: vi.fn(),
    moveLayer: vi.fn(),
    moveLayerGroup: vi.fn(),
  }),
}))

vi.mock('./core/layer-visibility.service', () => ({
  useLayerVisibilityService: () => ({
    toggleLayerVisibility: vi.fn(),
    setLayerVisibility: vi.fn(),
    toggleLayerGroupVisibility: vi.fn(),
    setLayerShownInSelector: vi.fn(),
    setGroupShownInSelector: vi.fn(),
    checkFadeBasemapVisibility: vi.fn(),
    applyFadedBasemap: vi.fn(),
  }),
}))

vi.mock('@/lib/transit.utils', () => ({
  isTransitStopLayer: (id: string) => id?.includes('transit-stops'),
}))

describe('useLayersService', () => {
  let mockMapStrategy: MapStrategy

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Create a mock MapStrategy
    mockMapStrategy = {
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
    } as any
  })

  describe('initializeLayers', () => {
    test('does nothing if no mapStrategy provided', () => {
      const service = useLayersService()
      const layers: Layer[] = [
        { id: 'layer-1', configuration: { id: 'layer-1' } } as Layer,
      ]

      service.initializeLayers(layers, undefined)

      expect(mockMapStrategy.addLayer).not.toHaveBeenCalled()
    })

    test('adds regular layers to map', () => {
      const service = useLayersService()
      const layers: Layer[] = [
        { id: 'layer-1', configuration: { id: 'layer-1' } } as Layer,
        { id: 'layer-2', configuration: { id: 'layer-2' } } as Layer,
      ]

      service.initializeLayers(layers, mockMapStrategy)

      expect(mockMapStrategy.addLayer).toHaveBeenCalledTimes(2)
      expect(mockMapStrategy.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'layer-1' })
      )
      expect(mockMapStrategy.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'layer-2' })
      )
    })

    test('handles search results layer specially', () => {
      const service = useLayersService()
      const layers: Layer[] = [
        { id: 'search-results-layer', configuration: { id: 'search-results-layer' } } as Layer,
        { id: 'other-layer', configuration: { id: 'other-layer' } } as Layer,
      ]

      service.initializeLayers(layers, mockMapStrategy)

      // Search results layer should be initialized via service, not added directly
      expect(mockSearchResultsService.initializeSearchResultsLayer).toHaveBeenCalledWith(mockMapStrategy)
      
      // Other layer should be added normally
      expect(mockMapStrategy.addLayer).toHaveBeenCalledTimes(1)
      expect(mockMapStrategy.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'other-layer' })
      )
    })

    test('adds transit stop click handlers for transit layers', () => {
      const service = useLayersService()
      const layers: Layer[] = [
        { id: 'transit-layer', configuration: { id: 'transit-stops-bus' } } as Layer,
      ]

      service.initializeLayers(layers, mockMapStrategy)

      expect(mockTransitService.addTransitStopClickHandlers).toHaveBeenCalledWith(
        mockMapStrategy,
        'transit-stops-bus'
      )
      expect(mockMapStrategy.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'transit-layer' })
      )
    })

    test('handles empty layers array', () => {
      const service = useLayersService()

      service.initializeLayers([], mockMapStrategy)

      expect(mockMapStrategy.addLayer).not.toHaveBeenCalled()
    })
  })

  describe('addLayerToMap', () => {
    test('adds layer to map', () => {
      const service = useLayersService()
      const layer: Layer = {
        id: 'new-layer',
        configuration: { id: 'new-layer' },
      } as Layer

      service.addLayerToMap(layer, mockMapStrategy)

      expect(mockMapStrategy.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-layer' })
      )
    })

    test('adds transit click handlers for transit layers', () => {
      const service = useLayersService()
      const layer: Layer = {
        id: 'transit-layer',
        configuration: { id: 'transit-stops-rail' },
      } as Layer

      service.addLayerToMap(layer, mockMapStrategy)

      expect(mockTransitService.addTransitStopClickHandlers).toHaveBeenCalledWith(
        mockMapStrategy,
        'transit-stops-rail'
      )
    })

    test('does nothing if no mapStrategy provided', () => {
      const service = useLayersService()
      const layer: Layer = {
        id: 'layer',
        configuration: { id: 'layer' },
      } as Layer

      service.addLayerToMap(layer, undefined)

      expect(mockMapStrategy.addLayer).not.toHaveBeenCalled()
    })
  })

  describe('removeLayerFromMap', () => {
    test('removes layer from map', () => {
      const service = useLayersService()

      service.removeLayerFromMap('layer-to-remove', mockMapStrategy)

      expect(mockMapStrategy.removeLayer).toHaveBeenCalledWith('layer-to-remove')
    })

    test('does nothing if no mapStrategy provided', () => {
      const service = useLayersService()

      service.removeLayerFromMap('layer-id', undefined)

      expect(mockMapStrategy.removeLayer).not.toHaveBeenCalled()
    })
  })
})
