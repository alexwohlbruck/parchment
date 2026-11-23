// OpenStreetMap serves Cross-Origin-Opener-Policy: same-origin, so by the
// time the OAuth popup lands back here its `window.opener` is severed and
// postMessage is impossible. This page is same-origin with the app, so it
// can hand the result over a BroadcastChannel instead.
var params = new URLSearchParams(location.search)
var status = params.get('status') === 'connected' ? 'connected' : 'error'
var message = params.get('message') || undefined

try {
  var channel = new BroadcastChannel('osm-oauth')
  channel.postMessage({ type: 'osm-oauth-callback', status: status, message: message })
  channel.close()
} catch (error) {
  // No channel: the app tab picks the result up when it regains focus.
}

document.getElementById('back').href =
  '/settings/integrations?osm=' + encodeURIComponent(status) +
  (message ? '&message=' + encodeURIComponent(message) : '')

window.close()

// A popup can only close itself in some browsers; say so if it's still here.
setTimeout(function () {
  document.getElementById('message').textContent =
    status === 'connected'
      ? 'Your OpenStreetMap account is connected. You can close this window.'
      : message || 'Something went wrong connecting your account.'
}, 300)
