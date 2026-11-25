import { describe, expect, it } from 'vitest'
import { broadcastHost, isBroadcastServer } from '../src/shared/broadcast'

describe('isBroadcastServer', () => {
  it.each([
    'rtmp://a.rtmp.youtube.com/live2',
    'rtmps://live.twitch.tv/app',
    'rtmp://localhost:1935/live',
    'rtmp://host',
  ])('accepts %s', (v) => {
    expect(isBroadcastServer(v)).toBe(true)
  })

  it.each([
    ['http scheme', 'http://example.com/live'],
    ['https scheme', 'https://example.com/live'],
    ['ftp scheme', 'ftp://example.com/live'],
    ['no scheme', 'example.com/live'],
    ['empty host', 'rtmp://'],
    ['empty host with path', 'rtmp:///live'],
    ['space in host', 'rtmp:// x'],
    ['space in path', 'rtmp://example.com/li ve'],
    ['leading space', ' rtmp://example.com/live'],
    ['trailing newline', 'rtmp://example.com/live\n'],
    ['tab', 'rtmp://example.com/\tlive'],
    ['empty string', ''],
  ])('rejects %s', (_label, v) => {
    expect(isBroadcastServer(v)).toBe(false)
  })

  it.each([undefined, null, 42, {}, [], true])('rejects non-string %p', (v) => {
    expect(isBroadcastServer(v)).toBe(false)
  })
})

describe('broadcastHost', () => {
  it('shows the host and port only', () => {
    expect(broadcastHost('rtmp://a.rtmp.youtube.com/live2/secret')).toBe('a.rtmp.youtube.com')
    expect(broadcastHost('rtmp://localhost:1935/live')).toBe('localhost:1935')
  })
  it('falls back to the raw value when it does not parse', () => {
    expect(broadcastHost('not a url')).toBe('not a url')
  })
})
