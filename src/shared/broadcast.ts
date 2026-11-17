/**
 * Online broadcast (YouTube, Twitch, PeerTube, a custom RTMP server…): the show, full HD with the subtitles,
 * published to the server under the stream key by the app itself (main/broadcast), never by OBS.
 */

/** An RTMP or RTMPS server address, e.g. `rtmp://a.rtmp.youtube.com/live2` (no spaces, a host). */
export function isBroadcastServer(v: unknown): v is string {
  if (typeof v !== 'string' || /\s/.test(v)) return false
  try {
    const u = new URL(v)
    return (u.protocol === 'rtmp:' || u.protocol === 'rtmps:') && u.hostname !== ''
  } catch {
    return false
  }
}

/** What the inspector shows of a server: its host (the path and any key embedded in it stay hidden). */
export function broadcastHost(server: string): string {
  try {
    return new URL(server).host || server
  } catch {
    return server
  }
}
