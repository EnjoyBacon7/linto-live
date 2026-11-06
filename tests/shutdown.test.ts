import { describe, it, expect, vi } from 'vitest'
import { shutdownWithCap } from '../src/main/shutdown'

describe('shutdownWithCap', () => {
  it('success: no kill', async () => {
    const kill = vi.fn()
    await shutdownWithCap(async () => {}, kill, 50)
    expect(kill).not.toHaveBeenCalled()
  })
  it('rejection: kill', async () => {
    const kill = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await shutdownWithCap(() => Promise.reject(new Error('x')), kill, 50)
    expect(kill).toHaveBeenCalledOnce()
  })
  it('timeout: kill', async () => {
    const kill = vi.fn()
    await shutdownWithCap(() => new Promise(() => {}), kill, 10)
    expect(kill).toHaveBeenCalledOnce()
  })
})
