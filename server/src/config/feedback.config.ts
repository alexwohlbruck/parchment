const url = process.env.QUACKBACK_URL?.replace(/\/+$/, '')
const apiKey = process.env.QUACKBACK_API_KEY

/**
 * Feedback is optional. Without a Quackback instance the endpoints report 503
 * and the client hides the feedback entry points.
 */
export const isFeedbackConfigured = Boolean(url && apiKey)

/**
 * The key must belong to an admin-role Quackback API key: attributing a post to
 * the user who wrote it (`authorPrincipalId`) is admin-gated upstream. A
 * member-role key silently files every post as the key's own principal.
 */
export const feedbackConfig = {
  url: url ?? '',
  apiKey: apiKey ?? '',
}
