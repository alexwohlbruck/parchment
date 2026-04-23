/**
 * Dawarich client module — plumbing only.
 *
 * Phase 1 ships the definition, the config form, and the encrypted-config
 * storage round-trip. It does NOT ship any upstream Dawarich API calls.
 *
 * When capabilities are added in follow-up PRs, add them here as functions
 * that take a `DawarichConfig` (read from `integrationsStore.byId('dawarich')
 * .config`) and talk to the third-party API directly. The Parchment server
 * is NOT on the request path for e2ee capability calls — see the
 * "Client-direct third-party call" section in
 * `/docs/crypto/completion-plan.md` (Part C.5a) for the expected pattern.
 */

export interface DawarichConfig {
  url: string
  apiToken: string
}
