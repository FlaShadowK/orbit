import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './sshConfig'

describe('parseSshConfig', () => {
  it('parses concrete hosts and skips wildcards', () => {
    const cfg = `
# comment
Host *
  User globaluser
  ServerAliveInterval 30

Host prod web-prod
  HostName 10.0.0.5
  Port 2222
  User deploy
  IdentityFile ~/.ssh/prod_ed25519

Host staging
  HostName=staging.example.com
  ProxyJump bastion

Host *.internal
  User x
`
    const hosts = parseSshConfig(cfg, 'me')
    expect(hosts.map((h) => h.name)).toEqual(['prod', 'web-prod', 'staging'])
    expect(hosts[0]).toMatchObject({ host: '10.0.0.5', port: 2222, username: 'deploy', keyPath: '~/.ssh/prod_ed25519' })
    expect(hosts[2]).toMatchObject({ host: 'staging.example.com', port: 22, username: 'globaluser', proxyJump: 'bastion' })
  })

  it('falls back to default user and host name', () => {
    const hosts = parseSshConfig('Host box\n', 'arman')
    expect(hosts).toEqual([{ name: 'box', host: 'box', port: 22, username: 'arman', keyPath: undefined, proxyJump: undefined }])
  })
})
