import { Page } from '@playwright/test'

/**
 * Enable WebAuthn virtual authenticator for passkey testing
 * This allows testing passkey registration and authentication in Playwright
 */
export async function enableVirtualAuthenticator(page: Page) {
  // Get CDP session for Chrome DevTools Protocol commands
  const client = await page.context().newCDPSession(page)
  
  // Enable WebAuthn
  await client.send('WebAuthn.enable')
  
  // Add virtual authenticator with resident key support
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  
  return { client, authenticatorId }
}

/**
 * Disable and remove virtual authenticator
 */
export async function disableVirtualAuthenticator(
  client: any,
  authenticatorId: string
) {
  await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  await client.send('WebAuthn.disable')
}

/**
 * Get credentials from virtual authenticator
 */
export async function getCredentials(client: any, authenticatorId: string) {
  const { credentials } = await client.send('WebAuthn.getCredentials', {
    authenticatorId,
  })
  return credentials
}

/**
 * Clear all credentials from virtual authenticator
 */
export async function clearCredentials(client: any, authenticatorId: string) {
  await client.send('WebAuthn.clearCredentials', { authenticatorId })
}
