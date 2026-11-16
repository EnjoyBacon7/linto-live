import type { StreamEndpoints } from '../../shared/types'

export interface ObsStreamService {
  streamServiceType: 'rtmp_custom'
  streamServiceSettings: { server: string; key: string }
}

/**
 * Why a channel cannot be streamed to: no endpoint at all (LinTO hands them only to users with the right), or
 * only an RTMP one. RTMP is not used: spikes/RESULTS.md (Spike B) found it KO towards LinTO (session flapping
 * active/ready every ~3.5 s, empty `final` events).
 */
export type StreamBlocker = 'forbidden' | 'rtmp-only'

/** OBS stream settings for a LinTO channel: SRT only (see `StreamBlocker`), null when it has no SRT endpoint. */
export function toObsStreamService(e: StreamEndpoints): ObsStreamService | null {
  return e.srt ? { streamServiceType: 'rtmp_custom', streamServiceSettings: { server: e.srt, key: '' } } : null
}

export function streamBlocker(e: StreamEndpoints): StreamBlocker | null {
  if (toObsStreamService(e)) return null
  return e.rtmp ? 'rtmp-only' : 'forbidden'
}
