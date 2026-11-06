import type { StreamEndpoints } from '../../shared/types'

export interface ObsStreamService {
  streamServiceType: 'rtmp_custom'
  streamServiceSettings: { server: string; key: string }
}

/** Default protocol: spikes/RESULTS.md has no protocol result yet, so SRT. */
export const DEFAULT_PREFER: 'srt' | 'rtmp' = 'srt'

const fromSrt = (url: string): ObsStreamService => ({
  streamServiceType: 'rtmp_custom',
  streamServiceSettings: { server: url, key: '' }
})

function fromRtmp(url: string): ObsStreamService {
  const i = url.lastIndexOf('/')
  return {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server: url.slice(0, i), key: url.slice(i + 1) }
  }
}

export function toObsStreamService(e: StreamEndpoints, prefer: 'srt' | 'rtmp' = DEFAULT_PREFER): ObsStreamService | null {
  const order: ('srt' | 'rtmp')[] = prefer === 'srt' ? ['srt', 'rtmp'] : ['rtmp', 'srt']
  for (const p of order) {
    const url = e[p]
    if (url) return p === 'srt' ? fromSrt(url) : fromRtmp(url)
  }
  return null
}
