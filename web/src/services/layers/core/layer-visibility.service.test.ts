/**
 * Unit tests for layer visibility service
 *
 * Tests cover:
 * - checkFadeBasemapVisibility
 * - applyFadedBasemap
 * - setLayerVisibility fadeBasemap behavior
 * - toggleLayerGroupVisibility fadeBasemap behavior
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useLayerVisibilityService } from './layer-visibility.service'
import type { Layer, LayerGroup } from '@/types/map.types'
import { LayerType, MapColorTheme } from '@/types/map.types'
import type { MapStrategy } from '@/components/map/map-providers/map.strategy'

// Mock the theme store
const mockThemeStore = { isDark: false }
vi.mock('@/stores/theme.store', () => ({
  useThemeStore: () => mockThemeStore,
}))

function createMockLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'test-layer',
    name: 'Test Layer',
    type: LayerType.CUSTOM,
    engine: [],
    showInLayerSelector: true,
    visible: false,
    order: 0,
    groupId: null,
    configuration: { id: 'test-config', type: 'line' as any, source: 'test' },
    ...overrides,
  } as Layer
}

function createMockMapStrategy(): MapStrategy {
  return {
    setMapColorTheme: vi.fn(),
    setTransitLabels: vi.fn(),
    toggleLayerVisibility: vi.fn(),
  } as any
}

describe('useLayerVisibilityService', () => {
  let service: ReturnType<typeof useLayerVisibilityService>

  beforeEach(() => {
    vi.clearAllMocks()
    mockThemeStore.isDark = false
    service = useLayerVisibilityService()
  })

  // ============================================================================
  // checkFadeBasemapVisibility
  // ============================================================================

  describe('checkFadeBasemapVisibility', () => {
    test('returns true when a fadeBasemap layer is visible', () => {
      const layers = [
        createMockLayer({ visible: true, fadeBasemap: true, configuration: { id: 'fade-1', type: 'line' as any, source: 'test' } }),
        createMockLayer({ visible: false, fadeBasemap: false, configuration: { id: 'normal-1', type: 'line' as any, source: 'test' } }),
      ]

      expect(service.checkFadeBasemapVisibility(layers)).toBe(true)
    })

    test('returns false when no fadeBasemap layers are visible', () => {
      const layers = [
        createMockLayer({ visible: false, fadeBasemap: true, configuration: { id: 'fade-1', type: 'line' as any, source: 'test' } }),
        createMockLayer({ visible: true, fadeBasemap: false, configuration: { id: 'normal-1', type: 'line' as any, source: 'test' } }),
      ]

      expect(service.checkFadeBasemapVisibility(layers)).toBe(false)
    })

    test('returns false when no layers have fadeBasemap', () => {
      const layers = [
        createMockLayer({ visible: true, configuration: { id: 'normal-1', type: 'line' as any, source: 'test' } }),
      ]

      expect(service.checkFadeBasemapVisibility(layers)).toBe(false)
    })

    test('uses newState override for the layer being toggled', () => {
      const layers = [
        createMockLayer({ visible: false, fadeBasemap: true, configuration: { id: 'fade-1', type: 'line' as any, source: 'test' } }),
      ]

      // Layer is currently not visible, but newState says it will be
      expect(service.checkFadeBasemapVisibility(layers, 'fade-1', true)).toBe(true)

      // Layer is currently not visible, newState also false
      expect(service.checkFadeBasemapVisibility(layers, 'fade-1', false)).toBe(false)
    })

    test('uses newState for target layer but current visibility for others', () => {
      const layers = [
        createMockLayer({ visible: false, fadeBasemap: true, configuration: { id: 'fade-1', type: 'line' as any, source: 'test' } }),
        createMockLayer({ visible: true, fadeBasemap: true, configuration: { id: 'fade-2', type: 'line' as any, source: 'test' } }),
      ]

      // Turning off fade-1, but fade-2 is still visible
      expect(service.checkFadeBasemapVisibility(layers, 'fade-1', false)).toBe(true)
    })
  })

  // ============================================================================
  // applyFadedBasemap
  // ============================================================================

  describe('applyFadedBasemap', () => {
    test('sets FADED theme in light mode when fade layers are visible', () => {
      mockThemeStore.isDark = false
      const mapStrategy = createMockMapStrategy()

      service.applyFadedBasemap(mapStrategy, true)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.FADED)
    })

    test('sets DEFAULT theme in dark mode even when fade layers are visible', () => {
      mockThemeStore.isDark = true
      const mapStrategy = createMockMapStrategy()

      service.applyFadedBasemap(mapStrategy, true)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.DEFAULT)
    })

    test('sets DEFAULT theme when no fade layers are visible', () => {
      mockThemeStore.isDark = false
      const mapStrategy = createMockMapStrategy()

      service.applyFadedBasemap(mapStrategy, false)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.DEFAULT)
    })

    test('does not call setTransitLabels', () => {
      const mapStrategy = createMockMapStrategy()

      service.applyFadedBasemap(mapStrategy, true)

      expect(mapStrategy.setTransitLabels).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // setLayerVisibility - fadeBasemap behavior
  // ============================================================================

  describe('setLayerVisibility', () => {
    test('applies basemap fade for fadeBasemap layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const layers = [
        createMockLayer({
          id: 'client-fade',
          visible: false,
          fadeBasemap: true,
          configuration: { id: 'fade-config', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
      }

      await service.setLayerVisibility('fade-config', layers, mockStore, mapStrategy, true)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.FADED)
    })

    test('does not apply basemap fade for non-fadeBasemap layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const layers = [
        createMockLayer({
          id: 'client-normal',
          visible: false,
          configuration: { id: 'normal-config', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
      }

      await service.setLayerVisibility('normal-config', layers, mockStore, mapStrategy, true)

      expect(mapStrategy.setMapColorTheme).not.toHaveBeenCalled()
    })

    test('hides transit labels for transit layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const layers = [
        createMockLayer({
          id: 'client-transit',
          visible: false,
          fadeBasemap: true,
          type: LayerType.TRANSIT,
          configuration: { id: 'transit-config', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
      }

      await service.setLayerVisibility('transit-config', layers, mockStore, mapStrategy, true)

      expect(mapStrategy.setTransitLabels).toHaveBeenCalledWith(false)
    })

    test('does not hide transit labels for non-transit fadeBasemap layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const layers = [
        createMockLayer({
          id: 'client-fade',
          visible: false,
          fadeBasemap: true,
          type: LayerType.CUSTOM,
          configuration: { id: 'fade-config', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
      }

      await service.setLayerVisibility('fade-config', layers, mockStore, mapStrategy, true)

      expect(mapStrategy.setTransitLabels).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // toggleLayerGroupVisibility - fadeBasemap behavior
  // ============================================================================

  describe('toggleLayerGroupVisibility', () => {
    test('applies basemap fade when group contains fadeBasemap layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const group: LayerGroup = {
        id: 'client-transit-group',
        name: 'Transit',
        showInLayerSelector: true,
        visible: false,
        order: 0,
        userId: 'user-1',
        createdAt: '',
        updatedAt: '',
      }
      const layers = [
        createMockLayer({
          id: 'client-transit-1',
          visible: false,
          fadeBasemap: true,
          type: LayerType.TRANSIT,
          groupId: 'client-transit-group',
          configuration: { id: 'transit-1', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        toggleLayerGroupVisibility: vi.fn(),
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
        updateLayerGroup: vi.fn(),
      }

      await service.toggleLayerGroupVisibility(group, true, mockStore, layers, mapStrategy)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.FADED)
      expect(mapStrategy.setTransitLabels).toHaveBeenCalledWith(false)
    })

    test('does not apply basemap fade when group has no fadeBasemap layers', async () => {
      const mapStrategy = createMockMapStrategy()
      const group: LayerGroup = {
        id: 'client-custom-group',
        name: 'Custom',
        showInLayerSelector: true,
        visible: false,
        order: 0,
        userId: 'user-1',
        createdAt: '',
        updatedAt: '',
      }
      const layers = [
        createMockLayer({
          id: 'client-custom-1',
          visible: false,
          groupId: 'client-custom-group',
          configuration: { id: 'custom-1', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        toggleLayerGroupVisibility: vi.fn(),
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
        updateLayerGroup: vi.fn(),
      }

      await service.toggleLayerGroupVisibility(group, true, mockStore, layers, mapStrategy)

      expect(mapStrategy.setMapColorTheme).not.toHaveBeenCalled()
    })

    test('restores DEFAULT theme when hiding group with fadeBasemap layers and no other fade layers visible', async () => {
      const mapStrategy = createMockMapStrategy()
      const group: LayerGroup = {
        id: 'client-transit-group',
        name: 'Transit',
        showInLayerSelector: true,
        visible: true,
        order: 0,
        userId: 'user-1',
        createdAt: '',
        updatedAt: '',
      }
      const layers = [
        createMockLayer({
          id: 'client-transit-1',
          visible: true,
          fadeBasemap: true,
          type: LayerType.TRANSIT,
          groupId: 'client-transit-group',
          configuration: { id: 'transit-1', type: 'line' as any, source: 'test' },
        }),
      ]
      const mockStore = {
        toggleLayerGroupVisibility: vi.fn(),
        updateLayerVisibility: vi.fn(),
        updateLayer: vi.fn(),
        updateLayerGroup: vi.fn(),
      }

      await service.toggleLayerGroupVisibility(group, false, mockStore, layers, mapStrategy)

      expect(mapStrategy.setMapColorTheme).toHaveBeenCalledWith(MapColorTheme.DEFAULT)
      expect(mapStrategy.setTransitLabels).toHaveBeenCalledWith(true)
    })
  })
})
