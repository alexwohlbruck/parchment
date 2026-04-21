/**
 * Federation two-server integration test.
 *
 * Spawns a real Parchment server (subprocess B) on a test port, connects it
 * to the configured Postgres. The test process itself acts as "server A" —
 * signs requests with A's identity key, serves A's .well-known manifest on a
 * second local port so B can pin A's key via TOFU.
 *
 * What this catches that unit tests miss:
 * - Elysia body-parse → canonical body-hash round-trip
 * - S2S header plumbing (outbound → inbound)
 * - Real TOFU-pin DB persistence
 * - Real replay-nonce cache
 * - Real i18n middleware / controller wiring
 *
 * Preconditions:
 * - Postgres reachable via the standard POSTGRES_* / DATABASE_URL env vars.
 * - Migrations applied (0029_federation_hardening must exist).
 *
 * DB hygiene: seeds fresh users with randomized aliases per run, deletes all
 * rows created during the test in afterAll. Does not touch any existing
 * application data.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import axios from 'axios'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

import {
  buildServerSignableWrapper,
  buildLegacySignableV1,
  canonicalJsonStringify,
  generateNonce,
  hashBody,
  nowIso,
} from '../lib/federation-canonical'
import { db } from '../db'
import { eq, inArray } from 'drizzle-orm'
import { users } from '../schema/users.schema'
import { friendInvitations } from '../schema/friend-invitations.schema'
import {
  federatedServerKeys,
  federationNonces,
} from '../schema/federation.schema'
import { generateId } from '../util'

// ---------------------------------------------------------------------------
// Test topology
// ---------------------------------------------------------------------------

const B_PORT = 5099
const B_HOST = `localhost:${B_PORT}`
const B_ORIGIN = `http://${B_HOST}`

const A_PORT = 5098
const A_HOST = `localhost:${A_PORT}`

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fixedSeed(label: number): Uint8Array {
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) seed[i] = (i * label + label * 7) & 0xff
  return seed
}

async function sign(message: string, priv: Uint8Array): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), priv)
  return bytesToBase64(sig)
}

// ---------------------------------------------------------------------------
// Identity / key state
// ---------------------------------------------------------------------------

const SERVER_A_SEED = fixedSeed(11)
const SERVER_B_SEED = fixedSeed(17)
let SERVER_A_PUB = ''
let SERVER_B_PUB = ''

const ALICE_SEED = fixedSeed(23)
let ALICE_PUB = ''

const BOB_SEED = fixedSeed(29)
let BOB_PUB = ''

// Randomized test aliases / emails so repeat runs don't collide.
const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
const ALICE_ALIAS = `e2e_alice_${RUN_SUFFIX}`
const BOB_ALIAS = `e2e_bob_${RUN_SUFFIX}`
const ALICE_HANDLE = `${ALICE_ALIAS}@${A_HOST}`
const BOB_HANDLE = `${BOB_ALIAS}@${B_HOST}`

let aliceUserId = ''
let bobUserId = ''

// ---------------------------------------------------------------------------
// Server A's fake well-known (Bun.serve, no Elysia to keep startup fast)
// ---------------------------------------------------------------------------

let aServer: ReturnType<typeof Bun.serve> | null = null

// Mutable so tests can simulate key rotation for pin-mismatch scenarios.
let aManifestKey = ''

function startServerA() {
  aServer = Bun.serve({
    hostname: '127.0.0.1',
    port: A_PORT,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)

      if (url.pathname === '/.well-known/parchment-server') {
        return new Response(
          JSON.stringify({
            server_id: A_HOST,
            public_key: aManifestKey,
            protocol_versions: [2],
            minimum_protocol_version: 2,
            capabilities: ['location-live'],
            key_transparency_anchor: null,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.pathname === `/.well-known/user/${ALICE_ALIAS}`) {
        return new Response(
          JSON.stringify({
            handle: ALICE_HANDLE,
            signingKey: ALICE_PUB,
            encryptionKey: '',
            inbox: `http://${A_HOST}/federation/inbox`,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response('not found', { status: 404 })
    },
  })
}

// ---------------------------------------------------------------------------
// Server B subprocess
// ---------------------------------------------------------------------------

let bProc: ReturnType<typeof Bun.spawn> | null = null

async function startServerB() {
  bProc = Bun.spawn(['bun', 'src/test-federation-server.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(B_PORT),
      HOST: '127.0.0.1',
      SERVER_ORIGIN: B_ORIGIN,
      CLIENT_ORIGIN: 'http://localhost:5173',
      SERVER_IDENTITY_PRIVATE_KEY: bytesToBase64(SERVER_B_SEED),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for B to become responsive.
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const r = await axios.get(
        `${B_ORIGIN}/.well-known/parchment-server`,
        { timeout: 500, validateStatus: () => true },
      )
      if (r.status === 200) return
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 150))
  }

  // Dump subprocess logs for debuggability then fail.
  const stderr = bProc.stderr
    ? await new Response(bProc.stderr as ReadableStream).text()
    : ''
  const stdout = bProc.stdout
    ? await new Response(bProc.stdout as ReadableStream).text()
    : ''
  throw new Error(
    `Server B did not become ready within 10s.\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
  )
}

// ---------------------------------------------------------------------------
// DB seed / cleanup
// ---------------------------------------------------------------------------

async function seedUsers() {
  aliceUserId = generateId()
  bobUserId = generateId()

  await db.insert(users).values({
    id: aliceUserId,
    email: `e2e-alice-${RUN_SUFFIX}@parchment.test`,
    alias: ALICE_ALIAS,
    signingKey: ALICE_PUB,
    encryptionKey: '',
  })
  await db.insert(users).values({
    id: bobUserId,
    email: `e2e-bob-${RUN_SUFFIX}@parchment.test`,
    alias: BOB_ALIAS,
    signingKey: BOB_PUB,
    encryptionKey: '',
  })
}

async function cleanupAllTestRows() {
  // Federation server-level rows tied to A's server id.
  await db
    .delete(federatedServerKeys)
    .where(eq(federatedServerKeys.serverId, A_HOST))
  await db
    .delete(federationNonces)
    .where(eq(federationNonces.senderServerId, A_HOST))

  // Domain rows tied to our test users.
  if (aliceUserId || bobUserId) {
    const ids = [aliceUserId, bobUserId].filter(Boolean)
    await db
      .delete(friendInvitations)
      .where(inArray(friendInvitations.localUserId, ids))
    await db.delete(users).where(inArray(users.id, ids))
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface SendOpts {
  tamperClientSig?: boolean
  tamperServerSig?: boolean
  overrideNonce?: string
  overrideTimestamp?: string
}

/**
 * Build and send a FRIEND_INVITE from alice@A to bob@B.
 * Returns the axios response (validateStatus disabled so we can inspect
 * status codes for negative tests).
 */
async function sendFriendInvite(opts: SendOpts = {}): Promise<{
  status: number
  data: unknown
  nonce: string
  timestamp: string
}> {
  const timestamp = opts.overrideTimestamp ?? nowIso()
  const nonce = opts.overrideNonce ?? generateNonce()

  // Alice signs the v1 FRIEND_INVITE envelope.
  const clientSignable = buildLegacySignableV1('FRIEND_INVITE', {
    from: ALICE_HANDLE,
    to: BOB_HANDLE,
    timestamp,
  })
  let clientSig = await sign(clientSignable, ALICE_SEED)
  if (opts.tamperClientSig) {
    clientSig = await sign(clientSignable + 'tamper', ALICE_SEED)
  }

  const message = {
    type: 'FRIEND_INVITE',
    from: ALICE_HANDLE,
    to: BOB_HANDLE,
    timestamp,
    signature: clientSig,
  }

  const bodyJson = canonicalJsonStringify(message)

  // Server A signs the transport wrapper.
  const wrapperCanonical = buildServerSignableWrapper({
    method: 'POST',
    path: '/federation/inbox',
    body_hash: hashBody(bodyJson),
    nonce,
    timestamp,
    peer_server_id: B_HOST,
    sender_server_id: A_HOST,
    protocol_version: 2,
  })
  let serverSig = await sign(wrapperCanonical, SERVER_A_SEED)
  if (opts.tamperServerSig) {
    serverSig = await sign(wrapperCanonical + 'tamper', SERVER_A_SEED)
  }

  const response = await axios.post(`${B_ORIGIN}/federation/inbox`, bodyJson, {
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      'X-Parchment-Server-Id': A_HOST,
      'X-Parchment-Protocol-Version': '2',
      'X-Parchment-Nonce': nonce,
      'X-Parchment-Timestamp': timestamp,
      'X-Parchment-Server-Signature': serverSig,
    },
    validateStatus: () => true,
  })

  return { status: response.status, data: response.data, nonce, timestamp }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  SERVER_A_PUB = bytesToBase64(await ed.getPublicKeyAsync(SERVER_A_SEED))
  SERVER_B_PUB = bytesToBase64(await ed.getPublicKeyAsync(SERVER_B_SEED))
  ALICE_PUB = bytesToBase64(await ed.getPublicKeyAsync(ALICE_SEED))
  BOB_PUB = bytesToBase64(await ed.getPublicKeyAsync(BOB_SEED))

  aManifestKey = SERVER_A_PUB

  await cleanupAllTestRows()
  await seedUsers()
  startServerA()
  await startServerB()
})

afterAll(async () => {
  if (bProc) {
    bProc.kill()
    await bProc.exited
    bProc = null
  }
  if (aServer) {
    aServer.stop(true)
    aServer = null
  }
  await cleanupAllTestRows()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('federation two-server integration', () => {
  test('manifest endpoint is reachable and publishes B\'s pubkey', async () => {
    const r = await axios.get(`${B_ORIGIN}/.well-known/parchment-server`, {
      validateStatus: () => true,
    })
    expect(r.status).toBe(200)
    expect(r.data.public_key).toBe(SERVER_B_PUB)
    expect(r.data.server_id).toBe(B_HOST)
    expect(r.data.protocol_versions).toContain(2)
  })

  test('happy path: signed FRIEND_INVITE round-trips, pin recorded, invite stored', async () => {
    const { status } = await sendFriendInvite()
    expect(status).toBe(202)

    // B pinned A's server key.
    const pin = await db
      .select()
      .from(federatedServerKeys)
      .where(eq(federatedServerKeys.serverId, A_HOST))
      .limit(1)
    expect(pin[0]?.publicKey).toBe(SERVER_A_PUB)

    // B recorded the invitation.
    const inv = await db
      .select()
      .from(friendInvitations)
      .where(eq(friendInvitations.localUserId, bobUserId))
    const incoming = inv.find(
      (r) => r.fromHandle === ALICE_HANDLE && r.direction === 'incoming',
    )
    expect(incoming).toBeTruthy()
    expect(incoming?.status).toBe('pending')
  })

  test('replay rejection: reusing the same nonce is 401', async () => {
    // Re-send a request with the exact same nonce + timestamp.
    const fixedNonce = generateNonce()
    const fixedTimestamp = nowIso()

    const first = await sendFriendInvite({
      overrideNonce: fixedNonce,
      overrideTimestamp: fixedTimestamp,
    })
    // First may succeed (202) or hit "invitation already exists" (400) — we
    // only care that auth passed. Either way, the nonce is now burned.
    expect([202, 400]).toContain(first.status)

    const second = await sendFriendInvite({
      overrideNonce: fixedNonce,
      overrideTimestamp: fixedTimestamp,
    })
    expect(second.status).toBe(401)
  })

  test('tampered client signature: 400 invalid signature', async () => {
    const r = await sendFriendInvite({ tamperClientSig: true })
    // S2S auth passes (server sig is valid) → proceed to client-sig verify →
    // processFederationMessage returns 400 with "Invalid signature".
    expect(r.status).toBe(400)
    const body = r.data as { message?: string }
    expect((body.message ?? '').toLowerCase()).toContain('signature')
  })

  test('tampered server signature: 401 S2S auth failure', async () => {
    const r = await sendFriendInvite({ tamperServerSig: true })
    expect(r.status).toBe(401)
  })

  test('pin mismatch: rotated A identity key is rejected after initial pin', async () => {
    // The pin from the happy-path test is in the DB. Rotate A's manifest to
    // a different key — B will fetch, see the mismatch, and reject.
    const rotatedSeed = fixedSeed(97)
    const rotatedPub = bytesToBase64(
      await ed.getPublicKeyAsync(rotatedSeed),
    )
    aManifestKey = rotatedPub

    try {
      const r = await sendFriendInvite()
      expect(r.status).toBe(401)
      const body = r.data as { message?: string }
      expect((body.message ?? '').toLowerCase()).toContain('identity key')
    } finally {
      // Restore for subsequent tests (if any are added later).
      aManifestKey = SERVER_A_PUB
    }
  })
})
