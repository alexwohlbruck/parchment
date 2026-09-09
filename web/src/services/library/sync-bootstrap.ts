/**
 * Register every replayable library mutation at startup.
 *
 * The queue persists across sessions, so a change made offline yesterday
 * has to find its handler today — even if the user never opens the screen
 * that created it. Registering these lazily (from the feature's own
 * service) meant the entry could outlive its handler and be dropped.
 */
import './bookmarks.sync'
import './canvases.sync'
import './routes.sync'
