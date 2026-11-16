import { describe, expect, it } from 'vitest'
import { streamBlocker, toObsStreamService } from '../../src/main/obs/streamTarget'

describe('toObsStreamService', () => {
  it('maps srt as-is with empty key', () => {
    const u = 'srt://h:9000?streamid=abc,0&mode=caller'
    expect(toObsStreamService({ srt: u, rtmp: 'rtmp://h:1935/abc/0' })).toEqual({
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: u, key: '' }
    })
  })
  it('never falls back to rtmp (KO towards LinTO, spikes/RESULTS.md)', () => {
    expect(toObsStreamService({ rtmp: 'rtmp://h:1935/abc/0' })).toBeNull()
  })
  it('returns null when only ws is present', () => {
    expect(toObsStreamService({ ws: 'wss://h/ws' })).toBeNull()
  })
})

describe('streamBlocker', () => {
  it('none with an srt endpoint', () => {
    expect(streamBlocker({ srt: 'srt://h:9000', rtmp: 'rtmp://h/a/0' })).toBeNull()
  })
  it('rtmp-only when LinTO hands out rtmp without srt', () => {
    expect(streamBlocker({ rtmp: 'rtmp://h/a/0' })).toBe('rtmp-only')
  })
  it('forbidden when there is no endpoint at all', () => {
    expect(streamBlocker({})).toBe('forbidden')
    expect(streamBlocker({ ws: 'wss://h/ws' })).toBe('forbidden')
  })
})
