import { describe, expect, it } from 'vitest'
import { publicLink } from '../src/shared/publicLink'

describe('publicLink', () => {
  it('builds the LinTO Studio public session URL', () => {
    expect(publicLink('https://studio.linto.ai', 'o1', 's1')).toBe('https://studio.linto.ai/interface/o1/sessions/s1')
  })
})
