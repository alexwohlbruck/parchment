import { test, expect } from 'bun:test'
import { summarizeBoards, type DepartureBoard } from './departure-board'

test('summarizeBoards reads a board the way a rider does, with alerts on its lines only', () => {
  const now = new Date('2026-11-16T13:40:00Z')
  const board: DepartureBoard = {
    stop: {
      stopId: '635',
      feedId: 'mta',
      name: '14 St-Union Sq',
      timezone: 'America/New_York',
    },
    departures: [
      {
        route: { id: '4', shortName: '4' },
        headsign: 'Woodlawn',
        departureTime: '2026-11-16T13:43:00Z',
        delay: 120,
        realTime: true,
        cancelled: false,
      },
      {
        route: { id: 'L', shortName: 'L' },
        tripDestination: 'Canarsie',
        departureTime: '2026-11-16T13:46:00Z',
        realTime: false,
        cancelled: true,
      },
    ],
  }
  const alerts = [
    {
      header: 'Delays on the 4',
      effect: 'SIGNIFICANT_DELAYS',
      informedEntities: [{ routeId: '4' }],
    },
    {
      header: 'G suspended',
      effect: 'NO_SERVICE',
      informedEntities: [{ routeId: 'G' }],
    },
  ]
  expect(summarizeBoards([board], alerts, now, 5)).toEqual([
    {
      station: '14 St-Union Sq',
      departures: [
        {
          line: '4',
          toward: 'Woodlawn',
          leaves: 'Mon 08:43',
          in_minutes: 3,
          live: true,
          late_minutes: 2,
        },
        {
          line: 'L',
          toward: 'Canarsie',
          leaves: 'Mon 08:46',
          in_minutes: 6,
          live: false,
          cancelled: true,
        },
      ],
      alerts: [
        { lines: ['4'], says: 'Delays on the 4', effect: 'significant delays' },
      ],
    },
  ])
})
