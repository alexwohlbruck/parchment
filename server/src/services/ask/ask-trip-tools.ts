import { distance } from '@turf/turf'
import { estimateModes } from '../mode-estimates.service'
import { multimodalTripService } from '../trip.service'
import { transitRoutingService } from '../transit-routing.service'
import { requestBarrelman } from '../barrelman.service'
import { integrationManager } from '../integrations'
import { getWeatherOutlook } from '../weather-outlook.service'
import { getPermissions, hasPermission } from '../auth.service'
import { getTimezone } from '../../lib/timezone'
import { getLanguageCode } from '../../lib/i18n'
import { distanceText } from '../../lib/ask/distance-text'
import {
  localClock,
  parseTripTime,
  summarizeItinerary,
  summarizeTrip,
} from '../../lib/ask/trip-summary'
import { TransitPriority } from '../../lib/transit/transit-gate'
import {
  ESTIMATE_MODES,
  type EstimateMode,
} from '../../lib/directions/mode-estimates'
import { IntegrationCapabilityId } from '../../types/integration.types'
import { PermissionId } from '../../types/auth.types'
import type { NearbyStation } from '../../lib/dock-alternatives'
import {
  ASK_TRIP_KINDS,
  type AskTripKind,
  type LatLng,
} from '../../types/ask.types'
import {
  AskToolError,
  cached,
  centre,
  clamp,
  endpoint,
  nearSchema,
  pointSchema,
  type PointArg,
  type AskContext,
  type AskTool,
} from './ask-tool-base'

const timeSchema = {
  type: 'string',
  description:
    'Local time at the trip, e.g. "2026-11-20T18:30". Defaults to now.',
}

function tripTime(
  input: string | undefined,
  at: LatLng,
  context: AskContext,
): Date {
  if (!input) return context.now
  const time = parseTripTime(input, getTimezone(at.lat, at.lng))
  if (!time)
    throw new AskToolError(`Unreadable time ${input}; use YYYY-MM-DDTHH:mm`)
  return time
}

const travelTimes: AskTool<{
  from?: PointArg
  to: PointArg
  modes?: EstimateMode[]
  depart_at?: string
}> = {
  name: 'travel_times',
  description:
    'Door-to-door minutes between two points for each way of getting there (walking, biking, driving, transit), to compare them. Null where a mode has no route.',
  parameters: {
    type: 'object',
    properties: {
      from: pointSchema("Start. Defaults to the map's centre."),
      to: pointSchema('Destination.'),
      modes: {
        type: 'array',
        items: { type: 'string', enum: [...ESTIMATE_MODES] },
      },
      depart_at: timeSchema,
    },
    required: ['to'],
  },
  label: () => 'Comparing ways to get there',
  async run(args, context) {
    if (
      !hasPermission(
        await getPermissions(context.userId),
        PermissionId.PREMIUM_NAVIGATION,
      )
    ) {
      throw new AskToolError('Comparing travel times needs Parchment Premium')
    }
    const from = await centre(args.from, context)
    const estimates = await estimateModes({
      waypoints: [from, await centre(args.to, context)],
      modes: args.modes?.length ? args.modes : [...ESTIMATE_MODES],
      departureTime: tripTime(args.depart_at, from, context).toISOString(),
      language: context.language,
    })
    return Object.fromEntries(
      Object.entries(estimates).map(([mode, seconds]) => [
        mode,
        seconds == null ? null : Math.round(seconds / 60),
      ]),
    )
  },
}

const transitTrips: AskTool<{
  from?: PointArg
  to: PointArg
  depart_at?: string
  arrive_by?: string
  count?: number
}> = {
  name: 'transit_trips',
  description:
    'Public transit trips between two points: when to leave, when you arrive, each line and where to change, with live delays where the agency publishes them. Give depart_at or arrive_by; to find the last trip of the night, depart late and read the latest result.',
  parameters: {
    type: 'object',
    properties: {
      from: pointSchema("Start. Defaults to the map's centre."),
      to: pointSchema('Destination.'),
      depart_at: timeSchema,
      arrive_by: {
        ...timeSchema,
        description: 'Arrive by this local time instead of departing at one',
      },
      count: {
        type: 'number',
        description: 'Trips to return, default 3, max 6',
      },
    },
    required: ['to'],
  },
  label: () => 'Checking transit',
  async run(args, context) {
    const from = await centre(args.from, context)
    const to = await centre(args.to, context)
    const timeZone = getTimezone(from.lat, from.lng)
    const arriveBy = !!args.arrive_by
    const time = tripTime(
      args.arrive_by ?? args.depart_at,
      arriveBy ? to : from,
      context,
    )
    const response = await transitRoutingService.getIntermodalRoute(
      {
        from,
        to,
        time: time.toISOString(),
        arriveBy,
        numItineraries: clamp(args.count, 3, 6),
        preTransitModes: ['WALK'],
        postTransitModes: ['WALK'],
      },
      TransitPriority.Core,
    )
    const trips = (response?.itineraries ?? []).filter((trip) =>
      trip.legs.some((leg) => leg.transitLeg),
    )
    if (!trips.length)
      throw new AskToolError('No transit trips found at that time')
    return {
      searched: `${arriveBy ? 'arrive by' : 'depart at'} ${localClock(time.toISOString(), timeZone)}`,
      trips: trips.map((trip) => summarizeItinerary(trip, timeZone)),
    }
  },
}

const planTrip: AskTool<{
  from?: PointArg
  to: PointArg
  kind?: AskTripKind
  depart_at?: string
  arrive_by?: string
}> = {
  name: 'plan_trip',
  description:
    'Plan a door-to-door trip the way Parchment Directions does: walking, cycling, bike share (with the stations to pick up and drop off at), transit and driving. The app offers the best trip as a Directions button. Set `kind` to get only one way of travelling.',
  parameters: {
    type: 'object',
    properties: {
      from: pointSchema('Start. Use "here" for the user\'s own location.'),
      to: pointSchema('Destination.'),
      kind: { type: 'string', enum: [...ASK_TRIP_KINDS] },
      depart_at: timeSchema,
      arrive_by: {
        ...timeSchema,
        description: 'Arrive by this local time instead of departing at one',
      },
    },
    required: ['to'],
  },
  label: () => 'Planning the trip',
  async run(args, context) {
    const from = await endpoint(args.from, context)
    const to = await endpoint(args.to, context)
    const timeZone = getTimezone(from.lat, from.lng)
    const result = await multimodalTripService.planTrip({
      waypoints: [
        { location: { lat: from.lat, lng: from.lng }, type: 'origin' },
        { location: { lat: to.lat, lng: to.lng }, type: 'destination' },
      ],
      selectedMode: 'multi',
      language: context.language,
      ...(args.depart_at && {
        preferredDepartureTime: tripTime(
          args.depart_at,
          from,
          context,
        ).toISOString(),
      }),
      ...(args.arrive_by && {
        preferredArrivalTime: tripTime(
          args.arrive_by,
          to,
          context,
        ).toISOString(),
      }),
      requestId: `ask-${crypto.randomUUID()}`,
      timestamp: context.now.toISOString(),
    })
    const all = result.trips.map(({ trip }) => summarizeTrip(trip, timeZone))
    if (!all.length) throw new AskToolError('No way to get there was found')
    const wanted = all.filter((trip) => !args.kind || trip.kind === args.kind)
    const trips = (wanted.length ? wanted : all).slice(0, 3)
    context.emit({ type: 'trip', from, to, kind: trips[0].kind })
    return {
      ...(!wanted.length && {
        note: `No ${args.kind} trip: the planner found it not worth it here. These are the other ways.`,
      }),
      trips,
    }
  },
}

const weather: AskTool<{ at?: PointArg }> = {
  name: 'weather',
  description:
    'Current weather at a point, and whether rain is due in the next few hours. It knows nothing about later days.',
  parameters: {
    type: 'object',
    properties: {
      at: pointSchema("Defaults to the map's centre."),
    },
  },
  label: () => 'Checking the weather',
  async run(args, context) {
    const { lat, lng } = await centre(args.at, context)
    const [record] = integrationManager.getConfiguredIntegrationsByCapability(
      IntegrationCapabilityId.WEATHER,
    )
    const capability =
      record &&
      integrationManager.getCachedIntegrationInstance(record)?.capabilities
        .weather
    if (!capability)
      throw new AskToolError('Weather is not available on this server')
    const key = { lat: lat.toFixed(2), lng: lng.toFixed(2) }
    const [now, outlook] = await Promise.all([
      cached('weather', key, { language: context.language }, () =>
        capability.getWeather(lat, lng, getLanguageCode(context.language)),
      ),
      getWeatherOutlook(lat, lng),
    ])
    return {
      covers: 'now and the next few hours only',
      condition: now.conditionDescription,
      temperature_c: Math.round(now.temperature),
      feels_like_c: Math.round(now.temperatureFeelsLike),
      ...(now.windSpeed != null && { wind_m_s: Math.round(now.windSpeed) }),
      ...(outlook && {
        rain_in_next_hours: outlook.rain,
        low_c: Math.round(outlook.minTemperature),
      }),
    }
  },
}

const bikeshareNearby: AskTool<{ near?: PointArg; radius_m?: number }> = {
  name: 'bikeshare_nearby',
  description:
    'Bike share stations near a point with live counts of bikes, e-bikes and free docks, nearest first.',
  parameters: {
    type: 'object',
    properties: {
      near: nearSchema,
      radius_m: {
        type: 'number',
        description: 'Search radius in metres, default 500, max 2000',
      },
    },
  },
  label: () => 'Checking bike share',
  async run(args, context) {
    const origin = await centre(args.near, context)
    const response = await requestBarrelman(
      '/gbfs/nearby-stations',
      {
        lat: origin.lat,
        lng: origin.lng,
        radius: clamp(args.radius_m, 500, 2000),
        limit: 10,
      },
      { cacheControl: 'no-cache' },
    )
    if (!response.ok)
      throw new AskToolError('Bike share availability is unavailable')
    const { stations = [] } = (await response.json()) as {
      stations?: NearbyStation[]
    }
    const meters = (station: NearbyStation) =>
      distance([origin.lng, origin.lat], [station.lon, station.lat], {
        units: 'meters',
      })
    return [...stations]
      .sort((a, b) => meters(a) - meters(b))
      .map((station) => ({
        name: station.name,
        lat: station.lat,
        lng: station.lon,
        distance: distanceText(meters(station), context.units),
        bikes: station.numBikesAvailable,
        ebikes: station.numEbikesAvailable ?? 0,
        docks: station.numDocksAvailable,
        renting: station.isRenting,
        returning: station.isReturning,
      }))
  },
}

export const tripTools: AskTool[] = [
  planTrip,
  travelTimes,
  transitTrips,
  weather,
  bikeshareNearby,
]
