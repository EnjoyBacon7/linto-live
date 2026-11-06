import { describe, expect, it } from 'vitest'
import { toObsStreamService } from '../../src/main/obs/streamTarget'

describe('toObsStreamService', () => {
  it('maps srt as-is with empty key', () => {
    const u = 'srt://h:9000?streamid=abc,0&mode=caller'
    expect(toObsStreamService({ srt: u }, 'srt')).toEqual({
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: { server: u, key: '' }
    })
  })
  it('splits rtmp url into server and key', () => {
    expect(toObsStreamService({ rtmp: 'rtmp://h:1935/abc/0' }, 'rtmp')?.streamServiceSettings).toEqual({
      server: 'rtmp://h:1935/abc',
      key: '0'
    })
  })
  it('falls back to rtmp when srt preferred but absent', () => {
    expect(toObsStreamService({ rtmp: 'rtmp://h:1935/abc/0' }, 'srt')?.streamServiceSettings.server).toBe('rtmp://h:1935/abc')
  })
  it('falls back to srt when rtmp preferred but absent', () => {
    expect(toObsStreamService({ srt: 'srt://h:9000?streamid=a' }, 'rtmp')?.streamServiceSettings.key).toBe('')
  })
  it('returns null when only ws is present', () => {
    expect(toObsStreamService({ ws: 'wss://h/ws' }, 'srt')).toBeNull()
  })
})
