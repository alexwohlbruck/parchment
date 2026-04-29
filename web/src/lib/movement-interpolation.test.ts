import { describe, expect, test } from 'vitest'
import {
  MIN_DR_SPEED,
  STALENESS_CAP_SEC,
  buildTrack,
  distanceMeters,
  easeOut,
  hermiteLatLng,
  lerpLatLng,
  predict,
  projectLatLng,
  type Track,
} from './movement-interpolation'

describe('easeOut', () => {
  test('clamps to [0,1]', () => {
    expect(easeOut(-1)).toBe(0)
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(2)).toBe(1)
  })

  test('decelerates near the end', () => {
    // ease-out: faster early, slower late. Halfway in time should be
    // PAST halfway in progress.
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })
})

describe('lerpLatLng', () => {
  const a = { lat: 0, lng: 0 }
  const b = { lat: 10, lng: 20 }

  test('t=0 returns a', () => {
    expect(lerpLatLng(a, b, 0)).toEqual(a)
  })

  test('t=1 returns b', () => {
    expect(lerpLatLng(a, b, 1)).toEqual(b)
  })

  test('t=0.5 returns midpoint', () => {
    const mid = lerpLatLng(a, b, 0.5)
    expect(mid.lat).toBeCloseTo(5, 6)
    expect(mid.lng).toBeCloseTo(10, 6)
  })

  test('clamps t outside [0,1]', () => {
    expect(lerpLatLng(a, b, -1)).toEqual(a)
    expect(lerpLatLng(a, b, 2)).toEqual(b)
  })
})

describe('projectLatLng', () => {
  test('east heading projects ~the right distance', () => {
    // 1 m/s east for 1000s → ~1km east. Equator, so cos(lat)=1.
    const out = projectLatLng({ lat: 0, lng: 0 }, 1, 90, 1000)
    expect(out.lat).toBeCloseTo(0, 6)
    // 1 km east at the equator is ~0.00898 degrees longitude.
    expect(out.lng).toBeCloseTo(0.00898, 4)
  })

  test('north heading projects to higher lat', () => {
    const out = projectLatLng({ lat: 35, lng: -80 }, 1, 0, 1000)
    expect(out.lat).toBeGreaterThan(35)
    expect(out.lng).toBeCloseTo(-80, 6)
  })

  test('zero distance is a no-op', () => {
    const origin = { lat: 35.21, lng: -80.82 }
    const out = projectLatLng(origin, 0, 90, 1000)
    expect(out.lat).toBeCloseTo(origin.lat, 9)
    expect(out.lng).toBeCloseTo(origin.lng, 9)
  })
})

describe('distanceMeters', () => {
  test('zero between identical points', () => {
    const p = { lat: 35.21, lng: -80.82 }
    expect(distanceMeters(p, p)).toBeCloseTo(0, 6)
  })

  test('symmetric', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 0, lng: 0.01 }
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6)
  })

  test('round-trip with projectLatLng', () => {
    // project east 100m, the distance back should be ~100m.
    const origin = { lat: 35.21, lng: -80.82 }
    const projected = projectLatLng(origin, 1, 90, 100) // 100m east
    expect(distanceMeters(origin, projected)).toBeCloseTo(100, 0)
  })
})

describe('predict', () => {
  const baseTrack: Track = {
    from: { lat: 0, lng: 0 },
    to: { lat: 0, lng: 0.01 }, // ~1.1 km east at the equator
    segmentStartMs: 1000,
    segmentDurationMs: 500,
    fromVelocity: null, // forces ease-out lerp path; Hermite tested separately
    postSpeed: 1,
    postHeading: 90, // east
    toSampleTimestamp: 1000,
  }

  test('returns from at segment start', () => {
    const out = predict(baseTrack, 1000)
    expect(out.lat).toBeCloseTo(baseTrack.from.lat, 6)
    expect(out.lng).toBeCloseTo(baseTrack.from.lng, 6)
  })

  test('returns to at segment end', () => {
    const out = predict(baseTrack, 1500)
    expect(out.lat).toBeCloseTo(baseTrack.to.lat, 6)
    expect(out.lng).toBeCloseTo(baseTrack.to.lng, 6)
  })

  test('eases between from and to during tween', () => {
    // Halfway through the tween, we should have made it MORE than halfway
    // because of the ease-out shape.
    const out = predict(baseTrack, 1250)
    expect(out.lng).toBeGreaterThan((baseTrack.from.lng + baseTrack.to.lng) / 2)
    expect(out.lng).toBeLessThan(baseTrack.to.lng)
  })

  test('dead-reckons forward past tween end with valid speed/heading', () => {
    // 1s past tween end; speed=1m/s east → ~0.00000898° east of `to`.
    const out = predict(baseTrack, 1500 + 1000)
    expect(out.lat).toBeCloseTo(baseTrack.to.lat, 6)
    expect(out.lng).toBeGreaterThan(baseTrack.to.lng)
  })

  test('holds at to past the staleness cap', () => {
    const wayPast = baseTrack.segmentStartMs +
      baseTrack.segmentDurationMs +
      (STALENESS_CAP_SEC + 5) * 1000
    const out = predict(baseTrack, wayPast)
    expect(out).toEqual(baseTrack.to)
  })

  test('holds at to when speed is null', () => {
    const noSpeed: Track = { ...baseTrack, postSpeed: null }
    const out = predict(noSpeed, baseTrack.segmentStartMs +
      baseTrack.segmentDurationMs + 5000)
    expect(out).toEqual(baseTrack.to)
  })

  test('holds at to when speed is below MIN_DR_SPEED', () => {
    const tooSlow: Track = { ...baseTrack, postSpeed: MIN_DR_SPEED - 0.1 }
    const out = predict(tooSlow, baseTrack.segmentStartMs +
      baseTrack.segmentDurationMs + 5000)
    expect(out).toEqual(baseTrack.to)
  })

  test('holds at to when heading is null', () => {
    const noHeading: Track = { ...baseTrack, postHeading: null }
    const out = predict(noHeading, baseTrack.segmentStartMs +
      baseTrack.segmentDurationMs + 5000)
    expect(out).toEqual(baseTrack.to)
  })
})

describe('buildTrack', () => {
  test('first sample (no currentRendered) skips the tween', () => {
    const t = buildTrack({
      currentRendered: null,
      sample: {
        lngLat: { lat: 35, lng: -80 },
        speed: 2,
        heading: 45,
        timestampMs: 5000,
      },
      now: 5100,
    })

    expect(t.from).toEqual(t.to)
    expect(t.segmentDurationMs).toBe(0)
    expect(t.fromVelocity).toBeNull()
    expect(t.postSpeed).toBe(2)
    expect(t.postHeading).toBe(45)
    expect(t.toSampleTimestamp).toBe(5000)
  })

  test('captures previous track velocity as entry tangent', () => {
    const prev: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35, lng: -79.99 },
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      fromVelocity: null,
      postSpeed: 5, // m/s
      postHeading: 90, // east
      toSampleTimestamp: 1000,
    }
    const t = buildTrack({
      currentRendered: { lat: 35, lng: -79.985 },
      previousTrack: prev,
      sample: {
        lngLat: { lat: 35.0001, lng: -79.98 },
        speed: 4,
        heading: 80,
        timestampMs: 6000,
      },
      now: 6000,
    })
    expect(t.fromVelocity).toEqual({ speedMps: 5, headingDeg: 90 })
  })

  test('previous track without speed/heading yields null fromVelocity', () => {
    const prev: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35, lng: -79.99 },
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      fromVelocity: null,
      postSpeed: null,
      postHeading: null,
      toSampleTimestamp: 1000,
    }
    const t = buildTrack({
      currentRendered: { lat: 35, lng: -79.99 },
      previousTrack: prev,
      sample: {
        lngLat: { lat: 35, lng: -79.98 },
        speed: 1,
        heading: 90,
        timestampMs: 6000,
      },
      now: 6000,
    })
    expect(t.fromVelocity).toBeNull()
  })

  test('subsequent sample tweens from currentRendered', () => {
    const current = { lat: 35, lng: -80 }
    // ~10m east of current
    const sampleLngLat = projectLatLng(current, 1, 90, 10)
    const t = buildTrack({
      currentRendered: current,
      sample: {
        lngLat: sampleLngLat,
        speed: 1.2,
        heading: 90,
        timestampMs: 5000,
      },
      now: 5000,
    })

    expect(t.from).toEqual(current)
    expect(t.to).toEqual(sampleLngLat)
    // 10m / 5 = 2ms → clamped up to MIN_TWEEN_MS = 200ms
    expect(t.segmentDurationMs).toBe(200)
  })

  test('big jump uses the upper tween cap', () => {
    const current = { lat: 35, lng: -80 }
    // 50m east → 50/5 = 10ms... not big. Need 5km+ for cap.
    const farLngLat = projectLatLng(current, 100, 90, 100) // 10km east
    const t = buildTrack({
      currentRendered: current,
      sample: {
        lngLat: farLngLat,
        speed: 0,
        heading: null,
        timestampMs: 5000,
      },
      now: 5000,
    })

    expect(t.segmentDurationMs).toBe(1000)
  })
})

describe('hermiteLatLng', () => {
  const p0 = { lat: 0, lng: 0 }
  const p1 = { lat: 0, lng: 1 }
  const t0 = { dLat: 0, dLng: 1 }
  const t1 = { dLat: 0, dLng: 1 }

  test('u=0 returns p0', () => {
    const out = hermiteLatLng(p0, p1, t0, t1, 0)
    expect(out.lat).toBeCloseTo(0)
    expect(out.lng).toBeCloseTo(0)
  })

  test('u=1 returns p1', () => {
    const out = hermiteLatLng(p0, p1, t0, t1, 1)
    expect(out.lat).toBeCloseTo(0)
    expect(out.lng).toBeCloseTo(1)
  })

  test('curves toward the entry tangent at u=0+', () => {
    // p0 = (0,0), p1 = (0,1). Entry tangent points NORTH (dLat>0),
    // exit tangent points EAST (dLng>0). Just past u=0 the position
    // should have nudged NORTH (positive lat) before turning east.
    const t0North = { dLat: 0.5, dLng: 0 }
    const t1East = { dLat: 0, dLng: 0.5 }
    const earlyOut = hermiteLatLng(p0, p1, t0North, t1East, 0.1)
    expect(earlyOut.lat).toBeGreaterThan(0)
  })

  test('clamps u outside [0,1]', () => {
    expect(hermiteLatLng(p0, p1, t0, t1, -1).lat).toBeCloseTo(0)
    expect(hermiteLatLng(p0, p1, t0, t1, 2).lng).toBeCloseTo(1)
  })
})

describe('predict (Hermite path)', () => {
  test('uses Hermite when both endpoint velocities are present', () => {
    // Right-angle turn: heading north, then heading east. The Hermite
    // curve should bow OUT (overshooting both axes) instead of cutting
    // a straight line corner.
    const track: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35.001, lng: -79.999 },
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      fromVelocity: { speedMps: 2, headingDeg: 0 }, // north
      postSpeed: 2,
      postHeading: 90, // east
      toSampleTimestamp: 1000,
    }
    const mid = predict(track, 1250)
    // Linear lerp midpoint would be at lat = 35.0005, lng = -79.9995.
    // Hermite with the velocity tangents should be NORTH of that line
    // (turning later than a straight cut would).
    expect(mid.lat).toBeGreaterThan(35.0005)
  })

  test('falls back to ease-out when entry velocity is missing', () => {
    const track: Track = {
      from: { lat: 0, lng: 0 },
      to: { lat: 0, lng: 0.01 },
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      fromVelocity: null, // no entry velocity → linear lerp
      postSpeed: 5,
      postHeading: 90,
      toSampleTimestamp: 1000,
    }
    const mid = predict(track, 1250)
    // ease-out at u=0.5 is past the linear midpoint
    expect(mid.lng).toBeGreaterThan(0.005)
    expect(mid.lng).toBeLessThan(0.01)
    // No N/S motion since no Hermite curve.
    expect(mid.lat).toBeCloseTo(0, 6)
  })
})
