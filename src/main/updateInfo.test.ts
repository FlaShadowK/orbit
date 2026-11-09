import { describe, expect, it } from 'vitest'
import { compareVersions, parseLatestYml } from './updateInfo'

const YML = `version: 0.1.1
files:
  - url: Orbit-0.1.1-mac-arm64.zip
    sha512: abc+/==
    size: 150000000
  - url: Orbit-0.1.1-mac-x64.zip
    sha512: 'def=='
    size: 153000000
  - url: Orbit-0.1.1-mac-arm64.dmg
    sha512: ghi==
    size: 1
path: Orbit-0.1.1-mac-arm64.zip
sha512: abc+/==
releaseDate: '2026-11-09T12:00:00.000Z'
`

describe('parseLatestYml', () => {
  it('reads the version and every file entry', () => {
    const info = parseLatestYml(YML)
    expect(info.version).toBe('0.1.1')
    expect(info.files).toEqual([
      { url: 'Orbit-0.1.1-mac-arm64.zip', sha512: 'abc+/==', size: 150000000 },
      { url: 'Orbit-0.1.1-mac-x64.zip', sha512: 'def==', size: 153000000 },
      { url: 'Orbit-0.1.1-mac-arm64.dmg', sha512: 'ghi==', size: 1 }
    ])
  })

  it('rejects files without a version', () => {
    expect(() => parseLatestYml('files:\n')).toThrow()
  })
})

describe('compareVersions', () => {
  it('orders semantic versions numerically', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(0)
  })
})
