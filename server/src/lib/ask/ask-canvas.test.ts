import { describe, expect, test } from 'bun:test'
import { askCanvasBody, fitCamera } from './ask-canvas'

const pizza = { name: 'Joe’s Pizza', lat: 40.7306, lng: -73.9894, placeId: 'osm/node/1', type: 'Pizza' }
const bagels = { name: 'Murray’s Bagels', lat: 40.7339, lng: -73.9993 }

describe('askCanvasBody', () => {
  test('draws each group as labelled points in its own colour', () => {
    const body = askCanvasBody([
      { name: 'Pizza', places: [pizza] },
      { name: 'Bagels', color: '#16a34a', places: [bagels] },
    ])
    expect(body.layers.map((layer) => layer.kind === 'data' && [layer.name, layer.render, layer.style?.color])).toEqual([
      ['Pizza', 'points', '#2563eb'],
      ['Bagels', 'points', '#16a34a'],
    ])
    const [first] = body.layers
    expect(first.kind === 'data' && first.data.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-73.9894, 40.7306] },
      properties: { name: 'Joe’s Pizza', placeId: 'osm/node/1', type: 'Pizza' },
    })
  })

  test('puts a trip underneath as a line, and ignores a colour that is not hex', () => {
    const body = askCanvasBody([{ name: 'Stops', color: 'red', places: [pizza] }], {
      name: 'Home to Work',
      path: [pizza, bagels],
    })
    expect(body.layers.map((layer) => layer.kind === 'data' && layer.render)).toEqual(['lines', 'points'])
    expect(body.layers[1].kind === 'data' && body.layers[1].style?.color).toBe('#2563eb')
  })

  test('opens on everything it holds', () => {
    expect(askCanvasBody([{ name: 'Pizza', places: [pizza, bagels] }]).camera?.center).toEqual([
      (-73.9894 + -73.9993) / 2,
      (40.7306 + 40.7339) / 2,
    ])
  })
})

describe('fitCamera', () => {
  test('zooms in on a neighbourhood and out on a city, within limits', () => {
    const neighbourhood = fitCamera([pizza, bagels])!.zoom
    const city = fitCamera([pizza, { lat: 40.6, lng: -73.8 }])!.zoom
    expect(neighbourhood).toBeGreaterThan(city)
    expect(fitCamera([pizza])!.zoom).toBe(16)
  })

  test('nothing to fit', () => {
    expect(fitCamera([])).toBeUndefined()
  })
})
