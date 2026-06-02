import { describe, expect, test } from 'vitest'
import {
  MIN_DR_SPEED,
  STALENESS_CAP_SEC,
  bearingDeg,
  buildConstrainedTrack,
  buildPolylineDistances,
  buildTrack,
  clamp,
  distanceMeters,
  easeOut,
  hermiteLatLng,
  interpolateAlongPolyline,
  lerpLatLng,
  predict,
  predictConstrained,
  projectLatLng,
  snapToPolyline,
  updateDrConfidence,
  type ConstrainedTrack,
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

describe('bearingDeg', () => {
  const origin = { lat: 35, lng: -80 }
  test('east is ~90°', () => {
    expect(bearingDeg(origin, { lat: 35, lng: -79.99 })).toBeCloseTo(90, 0)
  })
  test('north is ~0°', () => {
    expect(bearingDeg(origin, { lat: 35.01, lng: -80 })).toBeCloseTo(0, 0)
  })
  test('south is ~180°', () => {
    expect(bearingDeg(origin, { lat: 34.99, lng: -80 })).toBeCloseTo(180, 0)
  })
  test('west is ~270°', () => {
    expect(bearingDeg(origin, { lat: 35, lng: -80.01 })).toBeCloseTo(270, 0)
  })
  test('result always in [0, 360)', () => {
    for (let i = 0; i < 360; i += 17) {
      const target = projectLatLng(origin, 1, i, 100)
      const b = bearingDeg(origin, target)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(360)
    }
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
    hermiteT0: null, // ease-out lerp path
    hermiteT1: null,
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
      hermiteT0: null,
      hermiteT1: null,
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

  test('synthesizes speed and heading from previous sample when device omits them', () => {
    // Real-world phone GPS path: device emits null speed/heading, we
    // need to derive from the position delta so dead-reckoning works.
    const prev: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35, lng: -80 }, // arrived 1s ago at this point
      segmentStartMs: 0,
      segmentDurationMs: 0,
      fromVelocity: null,
      postSpeed: null,
      postHeading: null,
      toSampleTimestamp: 1000,
      hermiteT0: null,
      hermiteT1: null,
    }
    // 1s later, the next sample lands ~91m east (1m east is ~0.0000109°
    // longitude at lat 35; 0.001° ≈ 91m).
    const t = buildTrack({
      currentRendered: { lat: 35, lng: -80 },
      previousTrack: prev,
      sample: {
        lngLat: { lat: 35, lng: -79.999 },
        speed: null,
        heading: null,
        timestampMs: 2000,
      },
      now: 2000,
    })
    // ~91 m / 1s = ~91 m/s; bearing east.
    expect(t.postSpeed).not.toBeNull()
    expect(t.postSpeed!).toBeGreaterThan(50)
    expect(t.postSpeed!).toBeLessThan(150)
    expect(t.postHeading).not.toBeNull()
    expect(t.postHeading!).toBeGreaterThan(85)
    expect(t.postHeading!).toBeLessThan(95)
  })

  test('respects device-reported speed/heading when present (no synthesis)', () => {
    const prev: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35, lng: -80 },
      segmentStartMs: 0,
      segmentDurationMs: 0,
      fromVelocity: null,
      postSpeed: null,
      postHeading: null,
      toSampleTimestamp: 1000,
      hermiteT0: null,
      hermiteT1: null,
    }
    const t = buildTrack({
      currentRendered: { lat: 35, lng: -80 },
      previousTrack: prev,
      sample: {
        lngLat: { lat: 35, lng: -79.999 },
        speed: 3, // device-reported m/s — used as-is, not overwritten
        heading: 270, // west, deliberately wrong vs. the position delta
        timestampMs: 2000,
      },
      now: 2000,
    })
    expect(t.postSpeed).toBe(3)
    expect(t.postHeading).toBe(270)
  })

  test('does not synthesize when sub-meter jitter (no meaningful heading)', () => {
    const prev: Track = {
      from: { lat: 35, lng: -80 },
      to: { lat: 35, lng: -80 },
      segmentStartMs: 0,
      segmentDurationMs: 0,
      fromVelocity: null,
      postSpeed: null,
      postHeading: null,
      toSampleTimestamp: 1000,
      hermiteT0: null,
      hermiteT1: null,
    }
    // ~5cm east — well under 1m.
    const t = buildTrack({
      currentRendered: { lat: 35, lng: -80 },
      previousTrack: prev,
      sample: {
        lngLat: { lat: 35, lng: -80 + 0.0000005 },
        speed: null,
        heading: null,
        timestampMs: 2000,
      },
      now: 2000,
    })
    expect(t.postSpeed).toBeNull()
    expect(t.postHeading).toBeNull()
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
      hermiteT0: null,
      hermiteT1: null,
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
  test('uses Hermite when pre-computed tangents are present', () => {
    // Right-angle turn: heading north, then heading east. The Hermite
    // curve should bow OUT (overshooting both axes) instead of cutting
    // a straight line corner.
    const track = buildTrack({
      currentRendered: { lat: 35, lng: -80 },
      previousTrack: {
        from: { lat: 0, lng: 0 },
        to: { lat: 35, lng: -80 },
        segmentStartMs: 0,
        segmentDurationMs: 100,
        fromVelocity: null,
        postSpeed: 2, // m/s north
        postHeading: 0,
        toSampleTimestamp: 0,
        hermiteT0: null,
        hermiteT1: null,
      },
      sample: {
        lngLat: { lat: 35.001, lng: -79.999 },
        speed: 2,
        heading: 90, // east
        timestampMs: 1000,
      },
      now: 1000,
    })
    expect(track.hermiteT0).not.toBeNull()
    expect(track.hermiteT1).not.toBeNull()

    const mid = predict(
      { ...track, segmentStartMs: 1000, segmentDurationMs: 500 },
      1250,
    )
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
      hermiteT0: null,
      hermiteT1: null,
    }
    const mid = predict(track, 1250)
    // ease-out at u=0.5 is past the linear midpoint
    expect(mid.lng).toBeGreaterThan(0.005)
    expect(mid.lng).toBeLessThan(0.01)
    // No N/S motion since no Hermite curve.
    expect(mid.lat).toBeCloseTo(0, 6)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Polyline-constrained interpolation tests
// ═══════════════════════════════════════════════════════════════════

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  test('clamps below lower bound', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
  })
  test('clamps above upper bound', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })
  test('works when value equals bounds', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('buildPolylineDistances', () => {
  test('single-point polyline has zero length', () => {
    const pd = buildPolylineDistances([{ lat: 0, lng: 0 }])
    expect(pd.cumulativeDistances).toEqual([0])
    expect(pd.totalLength).toBe(0)
  })

  test('two-point polyline has correct total length', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 0, lng: 0.01 }
    const pd = buildPolylineDistances([a, b])
    expect(pd.cumulativeDistances).toHaveLength(2)
    expect(pd.cumulativeDistances[0]).toBe(0)
    expect(pd.totalLength).toBeCloseTo(distanceMeters(a, b), 1)
  })

  test('cumulative distances are monotonically increasing', () => {
    const polyline = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.03 },
      { lat: 0, lng: 0.06 },
    ]
    const pd = buildPolylineDistances(polyline)
    for (let i = 1; i < pd.cumulativeDistances.length; i++) {
      expect(pd.cumulativeDistances[i]).toBeGreaterThan(pd.cumulativeDistances[i - 1])
    }
  })

  test('total length is sum of all segment lengths', () => {
    const polyline = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0.01, lng: 0.01 },
    ]
    const pd = buildPolylineDistances(polyline)
    const seg1 = distanceMeters(polyline[0], polyline[1])
    const seg2 = distanceMeters(polyline[1], polyline[2])
    expect(pd.totalLength).toBeCloseTo(seg1 + seg2, 1)
  })
})

describe('snapToPolyline', () => {
  // Simple L-shaped polyline: east then north
  const polyline = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },    // east segment
    { lat: 0.01, lng: 0.01 }, // north segment
  ]
  const pd = buildPolylineDistances(polyline)

  test('snaps point near first segment to correct position', () => {
    // Point slightly north of the east segment midpoint
    const result = snapToPolyline(
      { lat: 0.001, lng: 0.005 },
      polyline,
      pd.cumulativeDistances,
      pd.totalLength,
    )
    // Should snap to roughly the midpoint of the first segment
    expect(result.snapped.lat).toBeCloseTo(0, 3)
    expect(result.snapped.lng).toBeCloseTo(0.005, 3)
    expect(result.fraction).toBeGreaterThan(0.2)
    expect(result.fraction).toBeLessThan(0.4)
  })

  test('snaps point at polyline start to fraction ≈ 0', () => {
    const result = snapToPolyline(
      { lat: 0, lng: 0 },
      polyline,
      pd.cumulativeDistances,
      pd.totalLength,
    )
    expect(result.fraction).toBeCloseTo(0, 2)
  })

  test('snaps point at polyline end to fraction ≈ 1', () => {
    const result = snapToPolyline(
      { lat: 0.01, lng: 0.01 },
      polyline,
      pd.cumulativeDistances,
      pd.totalLength,
    )
    expect(result.fraction).toBeCloseTo(1, 2)
  })

  test('returns bearing along the segment', () => {
    // Point near the east-heading segment → bearing ≈ 90°
    const result = snapToPolyline(
      { lat: 0, lng: 0.005 },
      polyline,
      pd.cumulativeDistances,
      pd.totalLength,
    )
    expect(result.bearing).toBeCloseTo(90, 0)
  })

  test('handles degenerate polyline (single point)', () => {
    const result = snapToPolyline(
      { lat: 5, lng: 5 },
      [{ lat: 0, lng: 0 }],
      [0],
      0,
    )
    expect(result.fraction).toBe(0)
    expect(result.snapped).toEqual({ lat: 5, lng: 5 })
  })

  test('fraction is clamped to [0,1]', () => {
    const result = snapToPolyline(
      { lat: -0.01, lng: 0 }, // behind the start
      polyline,
      pd.cumulativeDistances,
      pd.totalLength,
    )
    expect(result.fraction).toBeGreaterThanOrEqual(0)
    expect(result.fraction).toBeLessThanOrEqual(1)
  })
})

describe('interpolateAlongPolyline', () => {
  const polyline = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.02 }, // east ~2.2 km at equator
    { lat: 0.02, lng: 0.02 }, // north ~2.2 km
  ]
  const pd = buildPolylineDistances(polyline)

  test('fraction=0 returns the start', () => {
    const { position } = interpolateAlongPolyline(
      0, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(position.lat).toBeCloseTo(0, 6)
    expect(position.lng).toBeCloseTo(0, 6)
  })

  test('fraction=1 returns the end', () => {
    const { position } = interpolateAlongPolyline(
      1, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(position.lat).toBeCloseTo(0.02, 4)
    expect(position.lng).toBeCloseTo(0.02, 4)
  })

  test('fraction=0.5 returns midpoint of total distance', () => {
    const { position } = interpolateAlongPolyline(
      0.5, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    // Two equal-length segments → midpoint is at the corner vertex
    expect(position.lat).toBeCloseTo(0, 3)
    expect(position.lng).toBeCloseTo(0.02, 3)
  })

  test('returns bearing along the segment', () => {
    // At fraction 0.25 we're in the east-heading segment
    const { bearing } = interpolateAlongPolyline(
      0.25, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(bearing).toBeCloseTo(90, 0)
    // At fraction 0.75 we're in the north-heading segment
    const { bearing: b2 } = interpolateAlongPolyline(
      0.75, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(b2).toBeCloseTo(0, 0)
  })

  test('clamps fraction outside [0,1]', () => {
    const { position: neg } = interpolateAlongPolyline(
      -0.5, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(neg.lat).toBeCloseTo(0, 6)
    expect(neg.lng).toBeCloseTo(0, 6)

    const { position: over } = interpolateAlongPolyline(
      1.5, polyline, pd.cumulativeDistances, pd.totalLength,
    )
    expect(over.lat).toBeCloseTo(0.02, 4)
    expect(over.lng).toBeCloseTo(0.02, 4)
  })

  test('handles single-point polyline gracefully', () => {
    const { position } = interpolateAlongPolyline(
      0.5, [{ lat: 5, lng: 10 }], [0], 0,
    )
    expect(position.lat).toBe(5)
    expect(position.lng).toBe(10)
  })
})

describe('buildConstrainedTrack', () => {
  const polyline = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.02 },
    { lat: 0.02, lng: 0.02 },
  ]
  const pd = buildPolylineDistances(polyline)

  test('first sample snaps to polyline with no tween', () => {
    const ct = buildConstrainedTrack({
      currentRendered: null,
      sample: {
        lngLat: { lat: 0.001, lng: 0.01 }, // slightly off the first segment
        speed: 5,
        heading: 90,
        timestampMs: 1000,
      },
      polyline,
      polylineDistances: pd,
      now: 1000,
    })

    expect(ct.segmentDurationMs).toBe(0) // no tween for first sample
    expect(ct.toFraction).toBeGreaterThan(0)
    expect(ct.toFraction).toBeLessThan(1)
    expect(ct.fromFraction).toBe(ct.toFraction) // same position
    expect(ct.polyline).toBe(polyline)
    expect(ct.totalLength).toBe(pd.totalLength)
  })

  test('subsequent sample creates a tween between fractions', () => {
    // First sample at polyline start
    const first = buildConstrainedTrack({
      currentRendered: null,
      sample: {
        lngLat: { lat: 0, lng: 0 },
        speed: 5,
        heading: 90,
        timestampMs: 0,
      },
      polyline,
      polylineDistances: pd,
      now: 0,
    })

    // Second sample further along the polyline
    const second = buildConstrainedTrack({
      currentRendered: { lat: 0, lng: 0 },
      previousTrack: first,
      sample: {
        lngLat: { lat: 0, lng: 0.01 },
        speed: 5,
        heading: 90,
        timestampMs: 2000,
      },
      polyline,
      polylineDistances: pd,
      now: 2000,
    })

    expect(second.toFraction).toBeGreaterThan(second.fromFraction)
    expect(second.segmentDurationMs).toBeGreaterThan(0)
  })

  test('inherits base track properties (speed, heading, timestamp)', () => {
    const ct = buildConstrainedTrack({
      currentRendered: null,
      sample: {
        lngLat: { lat: 0, lng: 0.01 },
        speed: 8.5,
        heading: 45,
        timestampMs: 3000,
      },
      polyline,
      polylineDistances: pd,
      now: 3000,
    })

    expect(ct.postSpeed).toBe(8.5)
    expect(ct.postHeading).toBe(45)
    expect(ct.toSampleTimestamp).toBe(3000)
  })
})

describe('predictConstrained', () => {
  const polyline = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.02 },
    { lat: 0.02, lng: 0.02 },
  ]
  const pd = buildPolylineDistances(polyline)

  function makeConstrainedTrack(overrides: Partial<ConstrainedTrack> = {}): ConstrainedTrack {
    return {
      from: { lat: 0, lng: 0 },
      to: { lat: 0, lng: 0.01 },
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      fromVelocity: null,
      postSpeed: 5,
      postHeading: 90,
      toSampleTimestamp: 1000,
      hermiteT0: null,
      hermiteT1: null,
      polyline,
      cumulativeDistances: pd.cumulativeDistances,
      totalLength: pd.totalLength,
      fromFraction: 0,
      toFraction: 0.25,
      ...overrides,
    }
  }

  test('during tween phase, eases between fromFraction and toFraction', () => {
    const track = makeConstrainedTrack({
      fromFraction: 0,
      toFraction: 0.5,
      segmentStartMs: 1000,
      segmentDurationMs: 500,
    })

    // At segment start → near the fromFraction position
    const start = predictConstrained(track, 1000)
    const startExpected = interpolateAlongPolyline(
      0, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position
    expect(start.lat).toBeCloseTo(startExpected.lat, 4)
    expect(start.lng).toBeCloseTo(startExpected.lng, 4)

    // At segment end → near the toFraction position
    const end = predictConstrained(track, 1500)
    const endExpected = interpolateAlongPolyline(
      0.5, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position
    expect(end.lat).toBeCloseTo(endExpected.lat, 4)
    expect(end.lng).toBeCloseTo(endExpected.lng, 4)
  })

  test('midway through tween is past linear midpoint (ease-out)', () => {
    const track = makeConstrainedTrack({
      fromFraction: 0,
      toFraction: 0.5,
      segmentStartMs: 1000,
      segmentDurationMs: 500,
    })

    const mid = predictConstrained(track, 1250) // 50% through tween
    // Ease-out at 50% → fraction should be > linear midpoint of 0.25
    // The position should be closer to toFraction than a linear interpolation
    const linearMidPos = interpolateAlongPolyline(
      0.25, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position
    const toPos = interpolateAlongPolyline(
      0.5, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    // mid should be closer to the end than the linear midpoint
    const distToLinearMid = distanceMeters(mid, linearMidPos)
    const distToEnd = distanceMeters(mid, toPos)
    expect(distToEnd).toBeLessThan(distToLinearMid)
  })

  test('dead-reckons along polyline past tween when speed is valid', () => {
    const track = makeConstrainedTrack({
      fromFraction: 0,
      toFraction: 0.25,
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      postSpeed: 10, // 10 m/s
    })

    // 2 seconds past tween end → should advance along polyline
    const pos = predictConstrained(track, 1500 + 2000)
    const toPos = interpolateAlongPolyline(
      0.25, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    // Should be further along the polyline than toFraction
    const distFromTo = distanceMeters(pos, toPos)
    expect(distFromTo).toBeGreaterThan(10) // moved at least some distance
  })

  test('holds at toFraction past the staleness cap', () => {
    const track = makeConstrainedTrack({
      fromFraction: 0,
      toFraction: 0.25,
      segmentStartMs: 1000,
      segmentDurationMs: 500,
      postSpeed: 10,
    })

    const wayPast = 1000 + 500 + (STALENESS_CAP_SEC + 5) * 1000
    const pos = predictConstrained(track, wayPast)
    const toPos = interpolateAlongPolyline(
      0.25, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    expect(pos.lat).toBeCloseTo(toPos.lat, 4)
    expect(pos.lng).toBeCloseTo(toPos.lng, 4)
  })

  test('holds at toFraction when speed is below MIN_DR_SPEED', () => {
    const track = makeConstrainedTrack({
      toFraction: 0.3,
      postSpeed: MIN_DR_SPEED - 0.1,
    })

    const pos = predictConstrained(track, track.segmentStartMs + track.segmentDurationMs + 5000)
    const toPos = interpolateAlongPolyline(
      0.3, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    expect(pos.lat).toBeCloseTo(toPos.lat, 4)
    expect(pos.lng).toBeCloseTo(toPos.lng, 4)
  })

  test('holds at toFraction when speed is null', () => {
    const track = makeConstrainedTrack({
      toFraction: 0.4,
      postSpeed: null,
    })

    const pos = predictConstrained(track, track.segmentStartMs + track.segmentDurationMs + 5000)
    const toPos = interpolateAlongPolyline(
      0.4, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    expect(pos.lat).toBeCloseTo(toPos.lat, 4)
    expect(pos.lng).toBeCloseTo(toPos.lng, 4)
  })

  test('dead-reckon fraction clamped to 1 (does not overshoot end)', () => {
    const track = makeConstrainedTrack({
      toFraction: 0.99,
      postSpeed: 100, // very fast
      segmentStartMs: 1000,
      segmentDurationMs: 100,
    })

    // Even with high speed, should not overshoot fraction=1
    const pos = predictConstrained(track, 1100 + 10000)
    const endPos = interpolateAlongPolyline(
      1, polyline, pd.cumulativeDistances, pd.totalLength,
    ).position

    // Should be at or near the polyline end, not beyond
    expect(pos.lat).toBeCloseTo(endPos.lat, 4)
    expect(pos.lng).toBeCloseTo(endPos.lng, 4)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Dead-reckoning confidence tests
// ═══════════════════════════════════════════════════════════════════

describe('updateDrConfidence', () => {
  test('returns previous confidence when predicted travel is negligible', () => {
    // speed=0.1, dt=5 → predicted=0.5m (< 2m threshold) → keep previous
    expect(updateDrConfidence(0.5, 1000, 1000.5, 0.1, 5)).toBe(0.5)
  })

  test('returns previous confidence at zero speed', () => {
    expect(updateDrConfidence(0.5, 0, 50, 0, 5)).toBe(0.5)
  })

  test('returns previous confidence at zero dt', () => {
    expect(updateDrConfidence(0.5, 0, 50, 10, 0)).toBe(0.5)
  })

  test('ramps up slowly from 0 with good predictions', () => {
    // speed=10, dt=5 → predicted=50m, actual=45m → ratio=0.9 → good
    const c1 = updateDrConfidence(0, 0, 45, 10, 5)
    // alpha=0.25 (rising), sampleConf=0.8 → 0.25*0.8 + 0.75*0 = 0.2
    expect(c1).toBeCloseTo(0.2, 2)

    const c2 = updateDrConfidence(c1, 45, 95, 10, 5)
    expect(c2).toBeGreaterThan(c1)

    const c3 = updateDrConfidence(c2, 95, 145, 10, 5)
    expect(c3).toBeGreaterThan(c2)
  })

  test('converges near 0.8 for consistently good predictions', () => {
    let c = 0
    for (let i = 0; i < 30; i++) {
      c = updateDrConfidence(c, i * 50, (i + 1) * 50, 10, 5)
    }
    expect(c).toBeGreaterThan(0.75)
    expect(c).toBeLessThanOrEqual(0.8)
  })

  test('drops quickly on major overshoot', () => {
    // Start high, then overshoot: predicted 50m, actual 5m
    let c = 0.7
    c = updateDrConfidence(c, 1000, 1005, 10, 5)
    // ratio=0.1 → bad → sampleConf=0.1, alpha=0.6 (falling)
    // 0.6*0.1 + 0.4*0.7 = 0.34
    expect(c).toBeCloseTo(0.34, 2)
  })

  test('asymmetric: falls faster than it rises', () => {
    // Good sample from 0.3 → rising
    const rising = updateDrConfidence(0.3, 0, 50, 10, 5)
    const riseAmount = rising - 0.3

    // Bad sample from 0.7 → falling
    const falling = updateDrConfidence(0.7, 0, 5, 10, 5)
    const fallAmount = 0.7 - falling

    expect(fallAmount).toBeGreaterThan(riseAmount)
  })

  test('handles vehicle going backwards (negative actual travel)', () => {
    const c = updateDrConfidence(0.5, 1000, 990, 10, 5)
    // actualTravel=-10 → clamped to 0 → ratio=0 → bad (0.1)
    expect(c).toBeLessThan(0.3)
  })

  test('moderate mismatch gives moderate confidence adjustment', () => {
    // ratio=0.3 → moderate (sampleConf=0.4)
    const c = updateDrConfidence(0.5, 0, 15, 10, 5)
    // alpha=0.6 (falling since 0.4<0.5), 0.6*0.4 + 0.4*0.5 = 0.44
    expect(c).toBeCloseTo(0.44, 2)
  })

  test('recovery from overshoot takes multiple good samples', () => {
    let c = 0.7
    c = updateDrConfidence(c, 0, 5, 10, 5) // bad overshoot → ~0.34
    const afterOvershoot = c
    expect(afterOvershoot).toBeLessThan(0.4)

    // Track recovery: should take at least 2 good samples to pass 0.5
    let goodSamples = 0
    for (let i = 0; i < 20; i++) {
      c = updateDrConfidence(c, i * 50, (i + 1) * 50, 10, 5)
      goodSamples++
      if (c > 0.5) break
    }
    expect(goodSamples).toBeGreaterThanOrEqual(2)

    // And even after recovery, should take more samples to reach 0.7+
    let moreSamples = 0
    for (let i = goodSamples; i < 30; i++) {
      c = updateDrConfidence(c, i * 50, (i + 1) * 50, 10, 5)
      moreSamples++
      if (c > 0.7) break
    }
    expect(moreSamples).toBeGreaterThanOrEqual(3)
  })

  test('undershoot (vehicle faster than predicted) gives moderate confidence', () => {
    // predicted 50m, actual 80m → ratio=1.6 → moderate (0.4)
    const c = updateDrConfidence(0.5, 0, 80, 10, 5)
    expect(c).toBeLessThan(0.5) // slight decrease
    expect(c).toBeGreaterThan(0.35) // but not dramatic
  })

  test('perfect prediction gives high confidence', () => {
    // predicted 50m, actual 50m → ratio=1.0 → good (0.8)
    const c = updateDrConfidence(0.5, 0, 50, 10, 5)
    // alpha=0.25 (rising), 0.25*0.8 + 0.75*0.5 = 0.575
    expect(c).toBeCloseTo(0.575, 2)
  })
})
