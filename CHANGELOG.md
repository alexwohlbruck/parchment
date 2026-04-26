### Added

* Realtime system — server-side update pipeline plus web client manager and store handlers for live data sync
* Federated collection sharing — full sharing model with roles, resharing policies, public links, and federated identity support
* Google Docs–style Share Dialog — unified sharing UI with access list, avatars, real names, and public link controls
* Public link lifecycle — mint, revoke, and unauthenticated resolver endpoints
* Versioned collection keys — key rotation orchestrator and scheme-aware encryption support
* Dual-scheme integrations — support for multiple encryption schemes with client hydration and persistence
* Dawarich integration scaffold — E2EE-only integration plumbing and config schema
* Icon system expansion — Lucide alias search, Maki icons tab, and extended icon color options
* Virtualized icon picker — performant large icon grids via virtualization
* Settings search — fuzzy search for faster navigation
* Theme system expansion — extended palette, accent-aware neutrals, and additional theme options
* Toast improvements — ghost-style actions and contextual “View” actions
* Bookmark UX enhancements — collection picker, state badging, and improved interaction flows

### Changed

* Settings UI overhaul — colored icons, submenu structure, and improved navigation
* Share system refactor — replaced legacy dialogs with a unified Share Dialog
* Collections model — now uses last-saved pointer instead of default collection
* Bookmark behavior — second click now performs silent un-save and move
* Icon system wiring — consistent usage across bookmarks and collections
* Integration system refactor — scheme-aware CRUD, filtering, and hydration
* i18n expansion — identity, auth, and key management strings localized (en/es)
* Security UX — “Security” reframed as “Encryption keys” with clearer flows and warnings
* Passkey flow — consolidated to single biometric with automatic encrypted data restore
* Account and dialogs UI polish — tighter layouts, clearer states, improved copy across settings and recovery flows
* Alerts and theming — semantic variants, dark mode support, and refined color scales

### Fixed

* Bookmark write-gate vulnerability and related i18n key issue
* Remove-from-collection endpoint URL bug
* Collection picker ordering instability while open
* Cleanup of orphaned peer state after E2EE identity reset
* Integration controller error handling (distinguish known vs unexpected errors)
* Dependents endpoint scoping and userId leak
* Device-transfer race condition during sealed-seed upload
* Crypto boot checks and environment configuration reliability

### Removed

* Legacy ShareWithFriendDialog in favor of unified sharing flow
* Unused v1 location encryption helpers and stale TODO / placeholder code
* Location history tracking system
