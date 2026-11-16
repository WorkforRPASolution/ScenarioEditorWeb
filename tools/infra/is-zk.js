'use strict'
// 로컬 InterfaceServer 의 전용 ZooKeeper(infra/docker-compose.yml 의 is-zookeeper)에 판정 서버 노드를 만들고 지운다 (P4 설계 §10).
// InterfaceServer 는 아래 두 경로의 자식 노드 이름(`호스트:포트`)으로 Vision·OCR 판정 요청을 중계한다.
// ZooKeeper 클라이언트 패키지를 넣지 않고 컨테이너 안의 zkCli 를 한 명령씩 부른다(한 번에 1초쯤).
// 경로(…/daemons)는 InterfaceServer 가 뜰 때 만든다 — 없으면 "Node does not exist" 로 던진다(InterfaceServer 를 먼저 띄운다).
// 공유 로컬 ZooKeeper(ars-zookeeper)는 건드리지 않는다 — compose 서비스 이름으로만 들어간다.
const path = require('node:path')
const { execFile } = require('node:child_process')

const COMPOSE_FILE = path.join(__dirname, '../../infra/docker-compose.yml')
const SERVICE = 'is-zookeeper'
const PATHS = { vision: '/EARS/ARSImageProcessingSrv/daemons', ocr: '/EARS/ARSOCRProcessingSrv/daemons' }
const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9._-]*:(\d{1,5})$/

// 종료 코드와 출력(표준 출력 + 오류 출력)을 준다. 명령을 못 띄우면 던진다.
function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') return reject(err)
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` })
    })
  })
}

function createIsZk({ exec = runFile, composeFile = COMPOSE_FILE } = {}) {
  const head = ['compose', '-f', composeFile, 'exec', '-T', SERVICE, 'zkCli.sh', '-server', 'localhost:2181']
  const lastLine = (out) => String(out).trim().split('\n').pop() || ''

  function nodeOf(kind, address) {
    if (!PATHS[kind]) throw new Error(`unknown judge kind: ${kind}`)
    const m = ADDRESS.exec(String(address))
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 65535) throw new Error(`judge address must be host:port — ${address}`)
    return `${PATHS[kind]}/${address}`
  }
  // tolerate: 이 글이 출력에 있으면 실패가 아니다(이미 있음·이미 없음)
  async function zk(args, tolerate) {
    const { code, out } = await exec('docker', [...head, ...args])
    if (code !== 0 && !(tolerate && out.includes(tolerate))) throw new Error(`zkCli ${args[0]} failed (exit ${code}): ${lastLine(out)}`)
    return out
  }

  return {
    async add(kind, address) {
      const node = nodeOf(kind, address)
      await zk(['create', node, ''], 'Node already exists')
    },
    async remove(kind, address) {
      const node = nodeOf(kind, address)
      await zk(['delete', node], 'Node does not exist')
    },
    async list(kind) {
      if (!PATHS[kind]) throw new Error(`unknown judge kind: ${kind}`)
      const m = /^\[(.*)\]$/.exec(lastLine(await zk(['ls', PATHS[kind]])))
      if (!m) throw new Error('zkCli ls gave no list')
      return m[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
}

module.exports = { createIsZk, PATHS, COMPOSE_FILE }
