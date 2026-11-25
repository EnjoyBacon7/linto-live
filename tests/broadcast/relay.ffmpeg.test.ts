import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openBroadcast, type BroadcastSession } from '../../src/main/broadcast/relay'

const hasFfmpeg = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A free TCP port, picked by the OS instead of a random guess that may collide. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => resolve(port))
    })
  })

/**
 * Opens the broadcast once the RTMP server listens, retrying while the port refuses connections (ffmpeg takes
 * a while to start). `ffmpeg -listen 1` accepts a single client, so the port is not probed with a throwaway
 * connection: the real attempt is the probe, and only a refused connection is retried.
 */
async function openWhenListening(server: string, key: string, timeoutMs = 15_000): Promise<BroadcastSession> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      return await openBroadcast({ server, key })
    } catch (e) {
      if (Date.now() >= end) throw e
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

/** A real RTMP server (ffmpeg -listen) receives what the relay publishes, fed by an ffmpeg FLV source. */
describe.skipIf(!hasFfmpeg)('openBroadcast with ffmpeg on both ends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('relays audio + video to the RTMP server under the stream key', async () => {
    const port = await freePort()
    const out = join(dir, 'got.flv')
    const srv = spawn('ffmpeg', ['-v', 'error', '-y', '-listen', '1', '-i', `rtmp://127.0.0.1:${port}/live2/cle-secrete`, '-c', 'copy', out], { stdio: 'ignore' })
    const srvDone = new Promise((r) => srv.once('exit', r))
    const s = await openWhenListening(`rtmp://127.0.0.1:${port}/live2`, 'cle-secrete')
    expect(s.url).toMatch(/^unix:\//)
    const src = spawn('ffmpeg', [
      '-v', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '3', '-c:v', 'libx264', '-g', '60', '-c:a', 'aac', '-f', 'flv', s.url
    ], { stdio: 'ignore' })
    await new Promise((r) => src.once('exit', r))
    let closedWith: Error | null | undefined
    s.onClose((e) => (closedWith = e))
    await Promise.race([srvDone, new Promise((r) => setTimeout(r, 5000))])
    srv.kill('SIGKILL')
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out], { encoding: 'utf8' }))
    expect(probe.streams.map((x: { codec_type: string }) => x.codec_type).sort()).toEqual(['audio', 'video'])
    expect(Number(probe.format.duration)).toBeGreaterThan(2)
    expect(closedWith).toBeNull()
  }, 30_000)

  it('rejects quickly when nobody listens, without the key in the message', async () => {
    await expect(openBroadcast({ server: 'rtmp://127.0.0.1:9/live2', key: 'cle-secrete' })).rejects.toThrow(/^(?!.*cle-secrete)/)
  })
})
