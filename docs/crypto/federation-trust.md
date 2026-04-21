# Federation trust model

What each actor in a cross-server interaction can and cannot observe.

Consider: Alice on `a.example` is friends with Bob on `b.example`.

## Alice's home server (`a.example`) — honest-but-curious

Sees:
- Alice's email, alias, public keys.
- The fact that Alice is friends with `bob@b.example` (the handle pair
  is visible in her `friendships` row — necessary for routing).
- Alice's encrypted metadata envelopes (first/last name, collection
  metadata, canvas metadata). Cannot decrypt — no seed.
- Alice's encrypted personal blobs (search history, friend pins).
  Cannot decrypt.
- Alice's live-location ciphertexts in transit to Bob. Cannot decrypt —
  ECIES-sealed.
- The timing and frequency of Alice's location updates to Bob.
- Outgoing S2S messages Alice's server signs on Alice's behalf.

Cannot:
- Read Alice's location, names, collections, searches, friend display
  names.
- Forge a client signature (would need Alice's long-term Ed25519 priv).
- Impersonate Alice to `b.example` at the USER layer, even though it CAN
  impersonate itself at the SERVER layer. Bob's client verifies the
  user signature on every payload using the pinned Alice pubkey.

## Bob's home server (`b.example`) — treated as potentially hostile

Sees (as Bob's home):
- Bob's email, alias, public keys.
- Incoming payloads FROM Alice via `a.example` over S2S.
- Bob's ciphertext blobs just like Alice's home sees hers.

Can attempt:
- Inject a fake pubkey when Alice's server does
  `.well-known/user/bob`. Parchment counters this via per-client TOFU
  pins + safety numbers. Alice's client catches the key swap on the
  second successful interaction.
- Drop or reorder messages. Possible — federation is not designed to be
  byzantine-fault-tolerant. A hostile Bob-server can make Bob look
  offline to Alice.
- Replay old signed messages from Alice. Blocked by the server-level
  nonce cache + 5-min timestamp window.

Cannot:
- Read Alice's encrypted payloads (they're sealed to Bob's long-term
  encryption pub). But if it is Bob's home and Bob's encryption priv
  lives in Bob's client, the home server sees ciphertext only.
- Decrypt Alice's S2S body; the body contains user-level ciphertext.

## Bob's client

Sees, after decryption:
- Whatever Alice sent — live location data, friend-share payloads.
- Alice's pinned pubkeys, his own friend-pin metadata.

Cannot:
- See Alice's private messages to other friends.
- Decrypt past ciphertext he captured before friendship was established
  (the ECIES key exchange requires his current long-term encryption
  pub to be the sealer's target).

## Passive wire observer

Sees:
- TLS metadata: host, SNI, timing, packet sizes.
- That `a.example` is talking to `b.example`.

Cannot:
- Decrypt anything — content is TLS-sealed, and the body inside TLS is
  additionally end-to-end encrypted.

## Compromised server at runtime (RCE)

If an attacker gets code execution on a Parchment server:
- They see in-memory decryption of integration credentials during
  active bridge-mode fetches. Mitigated (not eliminated) by the
  external-secrets-manager deploy pattern for
  `PARCHMENT_INTEGRATION_ENCRYPTION_KEY` (which is otherwise a plain env var).
- They see inbound S2S requests while the process handles them — but
  user-E2EE bodies stay ciphertext because the server has no user seed.
- They can forge OUTBOUND S2S requests impersonating this server — but
  peers will reject those outbound requests at the USER signature step
  unless the attacker also has compromised a user's device.
- They cannot decrypt any user-E2EE data at rest, because the DB holds
  ciphertext only and the user seeds are on user devices.

## Key-transparency future work

`.well-known/parchment-server` reserves a `key_transparency_anchor`
field. A future CONIKS / KT-log integration would let clients verify
that the public key a server presents is the same one logged publicly
— making silent server-identity swaps detectable. Not shipped; the
current TOFU-plus-manual-re-pin model is the interim protection.
