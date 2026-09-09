/**
 * Offline license generator — run with your private key to produce a
 * signed PARCHMENT_LICENSE token.
 *
 * Usage:
 *   LICENSE_PRIVATE_KEY=<hex-seed> bun scripts/generate-license.ts [--exp 2027-01-01]
 *
 * To generate a keypair for the first time:
 *   bun scripts/generate-license.ts --keygen
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

async function keygen() {
  const privateKey = ed.utils.randomSecretKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  console.log('Private key (keep secret):')
  console.log(Buffer.from(privateKey).toString('hex'))
  console.log('\nPublic key (embed in license.ts):')
  console.log(Buffer.from(publicKey).toString('hex'))
}

async function generate() {
  const privateKeyHex = process.env.LICENSE_PRIVATE_KEY
  if (!privateKeyHex) {
    console.error('Set LICENSE_PRIVATE_KEY env var (hex-encoded 32-byte seed)')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const expIdx = args.indexOf('--exp')
  const expDate = expIdx !== -1 ? args[expIdx + 1] : undefined

  const payload = {
    org: 'parchment',
    features: ['billing'],
    ...(expDate ? { exp: Math.floor(new Date(expDate).getTime() / 1000) } : {}),
  }

  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8')
  const payloadB64 = payloadBytes.toString('base64')

  const privateKey = Buffer.from(privateKeyHex, 'hex')
  const signature = await ed.signAsync(payloadBytes, privateKey)
  const signatureHex = Buffer.from(signature).toString('hex')

  const token = `${payloadB64}.${signatureHex}`

  console.log('License payload:', JSON.stringify(payload, null, 2))
  console.log('\nPARCHMENT_LICENSE token:')
  console.log(token)
}

if (process.argv.includes('--keygen')) {
  keygen()
} else {
  generate()
}
