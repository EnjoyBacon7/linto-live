import { describe, expect, it, vi } from 'vitest'
import {
  detectRecordEncoder, isHardwareRecordEncoder, MAC_RECORD_ENCODER, NVENC_RECORD_ENCODER, nvencH264Supported,
  X264_RECORD_ENCODER
} from '../../src/main/obs/hwEncoder'

/** obs-nvenc-test's output (OBS 32.1), trimmed. */
const NVENC_OK = `[general]
nvml_ver=550.120
driver_ver=550.120
cuda_devices=1
nvenc_ver=12.2
nvenc_devices=1
latest_architecture=8
latest_architecture_name=Ampere
nvenc_supported=true

[av1]
codec_supported=0

[h264]
bframes=4
codec_supported=1

[hevc]
codec_supported=1
`
const NVENC_MISSING = `[general]
reason=nvenc_lib
nvenc_supported=false

[av1]
codec_supported=0

[h264]
codec_supported=0
`

describe('nvencH264Supported', () => {
  it('needs NVENC and its H.264 codec', () => {
    expect(nvencH264Supported(NVENC_OK)).toBe(true)
    expect(nvencH264Supported(NVENC_MISSING)).toBe(false)
    expect(nvencH264Supported(NVENC_OK.replace('[h264]\nbframes=4\ncodec_supported=1', '[h264]\ncodec_supported=0'))).toBe(false)
    expect(nvencH264Supported('')).toBe(false)
  })

  it('reads codec_supported of the h264 section only', () => {
    expect(nvencH264Supported('[general]\nnvenc_supported=true\n[hevc]\ncodec_supported=1\n')).toBe(false)
  })
})

describe('detectRecordEncoder', () => {
  const base = { obsExe: '/opt/LinTO Live/resources/obs/bin/obs', env: { A: '1' }, disabledMarker: '/data/obs-home/hw-encoder-disabled' }

  it('macOS: VideoToolbox, without probing', async () => {
    const run = vi.fn(async () => NVENC_OK)
    expect(await detectRecordEncoder({ ...base, platform: 'darwin', run })).toEqual(MAC_RECORD_ENCODER)
    expect(run).not.toHaveBeenCalled()
  })

  it('Linux: NVENC when OBS’s probe next to the obs binary finds it, with OBS’s environment', async () => {
    const run = vi.fn(async () => NVENC_OK)
    const enc = await detectRecordEncoder({ ...base, platform: 'linux', run, exists: (p) => p.endsWith('obs-nvenc-test') })
    expect(enc).toEqual(NVENC_RECORD_ENCODER)
    expect(run).toHaveBeenCalledWith('/opt/LinTO Live/resources/obs/bin/obs-nvenc-test', { A: '1' })
  })

  it('Linux: x264 without NVENC, without the probe, or once a hardware encoder failed here', async () => {
    const exists = (p: string): boolean => p.endsWith('obs-nvenc-test')
    expect(await detectRecordEncoder({ ...base, platform: 'linux', run: async () => NVENC_MISSING, exists })).toEqual(X264_RECORD_ENCODER)
    expect(await detectRecordEncoder({ ...base, platform: 'linux', run: async () => '', exists })).toEqual(X264_RECORD_ENCODER)
    const run = vi.fn(async () => NVENC_OK)
    expect(await detectRecordEncoder({ ...base, platform: 'linux', run, exists: () => false })).toEqual(X264_RECORD_ENCODER)
    expect(await detectRecordEncoder({ ...base, platform: 'linux', run, exists: () => true })).toEqual(X264_RECORD_ENCODER)
    expect(run).not.toHaveBeenCalled()
  })
})

it('isHardwareRecordEncoder', () => {
  expect(isHardwareRecordEncoder(NVENC_RECORD_ENCODER)).toBe(true)
  expect(isHardwareRecordEncoder(MAC_RECORD_ENCODER)).toBe(true)
  expect(isHardwareRecordEncoder(X264_RECORD_ENCODER)).toBe(false)
})
