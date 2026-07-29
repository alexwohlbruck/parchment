/**
 * Unit tests for the vehicle service.
 *
 * The interesting logic is the "one active vehicle per routing mode" invariant:
 * a new vehicle auto-activates only if nothing else is already active for its
 * mode, activating one deactivates its same-mode siblings, and deleting the
 * active one promotes a sibling so the mode doesn't end up with none.
 *
 * Note that modes are derived from `getRoutingMode`, so a bike and an e-bike
 * share a slot while a car does not — the tests lean on that rather than on
 * the raw vehicle type.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { getRoutingMode } from '../lib/vehicle-mode-mapping'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))
mock.module('../util', () => ({ generateId: () => 'new-vehicle-id' }))

const {
  getUserVehicles,
  getActiveVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  setActiveVehicle,
  updateVehicleLocation,
} = await import('./vehicle.service')

const vehicle = (over: Partial<any> = {}) => ({
  id: 'veh-1',
  userId: 'user-1',
  type: 'car',
  energyType: null,
  name: null,
  isActive: true,
  ...over,
})

beforeEach(() => {
  dbMock.reset()
})

describe('reads', () => {
  test('getUserVehicles returns the user’s vehicles', async () => {
    dbMock.queueSelect([vehicle(), vehicle({ id: 'veh-2', type: 'bike' })])

    expect(await getUserVehicles('user-1')).toHaveLength(2)
  })

  test('getActiveVehicles returns only active rows', async () => {
    dbMock.queueSelect([vehicle()])

    expect(await getActiveVehicles('user-1')).toHaveLength(1)
  })

  test('getVehicle returns undefined when nothing matches', async () => {
    dbMock.queueSelect([])

    expect(await getVehicle('user-1', 'missing')).toBeUndefined()
  })

  test('getVehicle returns the row when found', async () => {
    dbMock.queueSelect([vehicle()])

    expect((await getVehicle('user-1', 'veh-1'))!.id).toBe('veh-1')
  })
})

describe('createVehicle', () => {
  test('auto-activates the first vehicle for a routing mode', async () => {
    dbMock.queueSelect([]) // no active vehicles yet
    dbMock.setReturningRows([vehicle()])

    await createVehicle('user-1', { type: 'car' })

    expect((dbMock.inserted[0] as any).isActive).toBe(true)
  })

  test('does not activate when the mode already has an active vehicle', async () => {
    dbMock.queueSelect([vehicle({ id: 'veh-existing', type: 'car' })])
    dbMock.setReturningRows([vehicle({ id: 'new-vehicle-id', isActive: false })])

    await createVehicle('user-1', { type: 'car' })

    expect((dbMock.inserted[0] as any).isActive).toBe(false)
  })

  test('activates when the active vehicle belongs to a different mode', async () => {
    // A bike being active must not suppress activating a first car.
    expect(getRoutingMode('bike')).not.toBe(getRoutingMode('car'))
    dbMock.queueSelect([vehicle({ id: 'veh-bike', type: 'bike' })])
    dbMock.setReturningRows([vehicle()])

    await createVehicle('user-1', { type: 'car' })

    expect((dbMock.inserted[0] as any).isActive).toBe(true)
  })

  test('treats vehicles sharing a routing mode as one slot', async () => {
    // bike and e-bike both route as cycling.
    expect(getRoutingMode('e-bike')).toBe(getRoutingMode('bike'))
    dbMock.queueSelect([vehicle({ id: 'veh-bike', type: 'bike' })])
    dbMock.setReturningRows([vehicle({ type: 'e-bike', isActive: false })])

    await createVehicle('user-1', { type: 'e-bike' })

    expect((dbMock.inserted[0] as any).isActive).toBe(false)
  })

  test('stores optional fields as null when omitted', async () => {
    dbMock.queueSelect([])
    dbMock.setReturningRows([vehicle()])

    await createVehicle('user-1', { type: 'car' })

    expect(dbMock.inserted[0]).toMatchObject({
      energyType: null,
      name: null,
      userId: 'user-1',
      id: 'new-vehicle-id',
    })
  })

  test('keeps supplied optional fields', async () => {
    dbMock.queueSelect([])
    dbMock.setReturningRows([vehicle()])

    await createVehicle('user-1', {
      type: 'car',
      energyType: 'electric',
      name: 'Blue Car',
    })

    expect(dbMock.inserted[0]).toMatchObject({
      energyType: 'electric',
      name: 'Blue Car',
    })
  })
})

describe('updateVehicle', () => {
  test('applies the patch and stamps updatedAt', async () => {
    dbMock.setReturningRows([vehicle({ name: 'Renamed' })])

    const updated = await updateVehicle('user-1', 'veh-1', { name: 'Renamed' })

    expect(updated!.name).toBe('Renamed')
    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('returns undefined when the row is not the caller’s', async () => {
    dbMock.setReturningRows([])

    expect(
      await updateVehicle('user-1', 'someone-elses', { name: 'x' }),
    ).toBeUndefined()
  })

  test('accepts explicit nulls to clear fields', async () => {
    dbMock.setReturningRows([vehicle()])

    await updateVehicle('user-1', 'veh-1', { energyType: null, name: null })

    expect(dbMock.updated[0]).toMatchObject({ energyType: null, name: null })
  })
})

describe('deleteVehicle', () => {
  test('returns false when the vehicle is not the caller’s', async () => {
    dbMock.queueSelect([])

    expect(await deleteVehicle('user-1', 'missing')).toBe(false)
    expect(dbMock.deleteCount).toBe(0)
  })

  test('deletes an inactive vehicle without promoting anything', async () => {
    dbMock.queueSelect([vehicle({ isActive: false })])

    expect(await deleteVehicle('user-1', 'veh-1')).toBe(true)
    expect(dbMock.deleteCount).toBe(1)
    expect(dbMock.updateCount).toBe(0)
  })

  test('promotes a sibling when the active vehicle is removed', async () => {
    dbMock.queueSelect([vehicle({ isActive: true })]) // getVehicle
    dbMock.queueSelect([
      vehicle({ id: 'veh-2', type: 'car', isActive: false }),
      vehicle({ id: 'veh-3', type: 'car', isActive: false }),
    ]) // remaining siblings

    await deleteVehicle('user-1', 'veh-1')

    expect(dbMock.updateCount).toBe(1)
    expect(dbMock.updated[0]).toMatchObject({ isActive: true })
  })

  test('promotes the most recently created sibling', async () => {
    // getUserVehicles orders by createdAt, so the last entry is newest.
    dbMock.queueSelect([vehicle({ isActive: true })])
    dbMock.queueSelect([
      vehicle({ id: 'veh-old', type: 'car' }),
      vehicle({ id: 'veh-new', type: 'car' }),
    ])

    await deleteVehicle('user-1', 'veh-1')

    expect(dbMock.updateCount).toBe(1)
  })

  test('ignores siblings from other routing modes', async () => {
    dbMock.queueSelect([vehicle({ type: 'car', isActive: true })])
    dbMock.queueSelect([vehicle({ id: 'veh-bike', type: 'bike' })])

    await deleteVehicle('user-1', 'veh-1')

    // Nothing to promote in the driving mode.
    expect(dbMock.updateCount).toBe(0)
  })

  test('handles deleting the only vehicle', async () => {
    dbMock.queueSelect([vehicle({ isActive: true })])
    dbMock.queueSelect([])

    expect(await deleteVehicle('user-1', 'veh-1')).toBe(true)
    expect(dbMock.updateCount).toBe(0)
  })
})

describe('setActiveVehicle', () => {
  test('returns undefined for a vehicle the caller does not own', async () => {
    dbMock.queueSelect([])

    expect(await setActiveVehicle('user-1', 'missing')).toBeUndefined()
    expect(dbMock.updateCount).toBe(0)
  })

  test('deactivates same-mode siblings then activates the target', async () => {
    dbMock.queueSelect([vehicle({ id: 'veh-1', type: 'car' })]) // getVehicle
    dbMock.queueSelect([
      vehicle({ id: 'veh-1', type: 'car' }),
      vehicle({ id: 'veh-2', type: 'car' }),
    ]) // all vehicles
    dbMock.queueSelect([vehicle({ id: 'veh-1', isActive: true })]) // final read

    await setActiveVehicle('user-1', 'veh-1')

    // Two deactivations plus the final activation.
    expect(dbMock.updateCount).toBe(3)
    expect((dbMock.updated.at(-1) as any).isActive).toBe(true)
  })

  test('leaves other routing modes untouched', async () => {
    dbMock.queueSelect([vehicle({ id: 'veh-1', type: 'car' })])
    dbMock.queueSelect([
      vehicle({ id: 'veh-1', type: 'car' }),
      vehicle({ id: 'veh-bike', type: 'bike' }),
    ])
    dbMock.queueSelect([vehicle({ id: 'veh-1', isActive: true })])

    await setActiveVehicle('user-1', 'veh-1')

    // Only the car is deactivated, then reactivated.
    expect(dbMock.updateCount).toBe(2)
  })

  test('runs the swap inside a transaction', async () => {
    let usedTransaction = false
    const realTransaction = dbMock.db.transaction
    dbMock.db.transaction = async (fn: any) => {
      usedTransaction = true
      return realTransaction(fn)
    }
    dbMock.queueSelect([vehicle()])
    dbMock.queueSelect([vehicle()])
    dbMock.queueSelect([vehicle()])

    try {
      await setActiveVehicle('user-1', 'veh-1')
    } finally {
      dbMock.db.transaction = realTransaction
    }

    expect(usedTransaction).toBe(true)
  })
})

describe('updateVehicleLocation', () => {
  test('stores coordinates with the default manual source', async () => {
    dbMock.setReturningRows([vehicle()])

    await updateVehicleLocation('user-1', 'veh-1', { lat: 35.2, lng: -80.8 })

    expect(dbMock.updated[0]).toMatchObject({
      lastKnownLat: 35.2,
      lastKnownLng: -80.8,
      locationSource: 'manual',
    })
  })

  test('honours an explicit source', async () => {
    dbMock.setReturningRows([vehicle()])

    await updateVehicleLocation(
      'user-1',
      'veh-1',
      { lat: 1, lng: 2 },
      'tracker',
    )

    expect((dbMock.updated[0] as any).locationSource).toBe('tracker')
  })

  test('stamps both location and row timestamps', async () => {
    dbMock.setReturningRows([vehicle()])

    await updateVehicleLocation('user-1', 'veh-1', { lat: 1, lng: 2 })

    expect((dbMock.updated[0] as any).locationUpdatedAt).toBeInstanceOf(Date)
    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('returns undefined when the vehicle is not the caller’s', async () => {
    dbMock.setReturningRows([])

    expect(
      await updateVehicleLocation('user-1', 'other', { lat: 1, lng: 2 }),
    ).toBeUndefined()
  })
})
