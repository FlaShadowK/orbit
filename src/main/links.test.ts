import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './links'

describe('isSafeExternalUrl', () => {
  it('allows web and mail links', () => {
    expect(isSafeExternalUrl('https://github.com')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:3000/x')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true)
  })

  it('refuses local files, scripts, custom schemes and junk', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('smb://host/share')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})
