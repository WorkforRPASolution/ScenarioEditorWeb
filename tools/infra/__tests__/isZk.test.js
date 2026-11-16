// 전용 ZooKeeper(is-zookeeper)의 판정 서버 노드 — 컨테이너 안의 zkCli 를 불러 만들고 지운다(P4 설계 §10). 여기서는 명령 줄만 본다(가짜 exec).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { createIsZk, PATHS } = require('../is-zk')

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const HEAD = ['compose', '-f', join(ROOT, 'infra/docker-compose.yml'), 'exec', '-T', 'is-zookeeper', 'zkCli.sh', '-server', 'localhost:2181']
// answers: 호출 순서대로 { code, out }
function fakeExec(answers = []) {
  const calls = []
  const exec = async (file, args) => {
    calls.push({ file, args })
    return answers[calls.length - 1] ?? { code: 0, out: '' }
  }
  return { exec, calls }
}

describe('is-zk', () => {
  it('경로는 InterfaceServer 가 지켜보는 둘이다', () => {
    expect(PATHS).toEqual({ vision: '/EARS/ARSImageProcessingSrv/daemons', ocr: '/EARS/ARSOCRProcessingSrv/daemons' })
  })

  it('add: docker compose exec 로 zkCli create 를 부른다(값은 빈 글)', async () => {
    const { exec, calls } = fakeExec([{ code: 0, out: 'Created /EARS/ARSImageProcessingSrv/daemons/host.docker.internal:50123\n' }])
    await createIsZk({ exec }).add('vision', 'host.docker.internal:50123')
    expect(calls).toEqual([{ file: 'docker', args: [...HEAD, 'create', '/EARS/ARSImageProcessingSrv/daemons/host.docker.internal:50123', ''] }])
  })

  it('add: 이미 있으면 넘어간다. 그 밖의 실패는 출력의 끝 줄과 함께 던진다', async () => {
    const exists = fakeExec([{ code: 1, out: 'WatchedEvent state:SyncConnected\nNode already exists: /EARS/ARSOCRProcessingSrv/daemons/h:1\n' }])
    await createIsZk({ exec: exists.exec }).add('ocr', 'h:1')
    const missing = fakeExec([{ code: 1, out: 'WatchedEvent\nNode does not exist: /EARS/ARSOCRProcessingSrv/daemons/h:1\n' }])
    await expect(createIsZk({ exec: missing.exec }).add('ocr', 'h:1')).rejects.toThrow(/Node does not exist/)
  })

  it('remove: zkCli delete — 이미 없으면 넘어간다', async () => {
    const { exec, calls } = fakeExec([{ code: 0, out: '' }, { code: 1, out: 'Node does not exist: /x\n' }])
    const zk = createIsZk({ exec })
    await zk.remove('ocr', 'host.docker.internal:50123')
    await zk.remove('ocr', 'host.docker.internal:50123')
    expect(calls[0].args).toEqual([...HEAD, 'delete', '/EARS/ARSOCRProcessingSrv/daemons/host.docker.internal:50123'])
    const down = fakeExec([{ code: 1, out: 'service "is-zookeeper" is not running\n' }])
    await expect(createIsZk({ exec: down.exec }).remove('ocr', 'h:1')).rejects.toThrow(/is not running/)
  })

  it('list: 끝 줄의 [a, b] 를 읽는다. 비었으면 빈 목록', async () => {
    const { exec, calls } = fakeExec([
      { code: 0, out: 'WatchedEvent state:SyncConnected type:None path:null\n[host.docker.internal:50001, 10.0.0.5:9400]\n' },
      { code: 0, out: 'WatchedEvent\n[]\n' }
    ])
    const zk = createIsZk({ exec })
    expect(await zk.list('vision')).toEqual(['host.docker.internal:50001', '10.0.0.5:9400'])
    expect(await zk.list('ocr')).toEqual([])
    expect(calls[0].args).toEqual([...HEAD, 'ls', '/EARS/ARSImageProcessingSrv/daemons'])
  })

  it('주소가 `호스트:포트` 가 아니거나 종류를 모르면 명령을 부르지 않고 던진다', async () => {
    const { exec, calls } = fakeExec()
    const zk = createIsZk({ exec })
    for (const bad of ['host', 'host:', ':9300', 'a/b:1', 'host:0', 'host:70000', 'host:12 x', '']) {
      await expect(zk.add('vision', bad), bad).rejects.toThrow()
      await expect(zk.remove('vision', bad), bad).rejects.toThrow()
    }
    await expect(zk.add('other', 'h:1')).rejects.toThrow()
    await expect(zk.list('other')).rejects.toThrow()
    expect(calls).toEqual([])
  })
})
