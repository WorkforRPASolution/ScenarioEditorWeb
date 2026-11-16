// vision.proto 사본 — InterfaceServer 것과 바이트가 같아야 한다(P4 설계 §5.1). 출처는 proto/README.md 에 적는다.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const HERE = fileURLToPath(new URL('.', import.meta.url))
const PROTO = join(HERE, '../proto/vision.proto')
const README = join(HERE, '../proto/README.md')
// 작업 공간에 InterfaceServer 저장소가 있을 때만 견준다(사내 PC·CI 에는 없다)
const UPSTREAM = join(HERE, '../../../../../InterfaceServer/src/main/proto/vision.proto')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

describe('vision.proto 사본', () => {
  it('README 에 적힌 sha256 과 같다', () => {
    const noted = /sha256[\s|:=]*`([0-9a-f]{64})`/.exec(readFileSync(README, 'utf8')) // 표의 칸: | sha256 | `…` |
    expect(noted, 'README 에 sha256 이 없다').not.toBeNull()
    expect(sha256(readFileSync(PROTO))).toBe(noted[1])
  })

  it.skipIf(!existsSync(UPSTREAM))('작업 공간의 InterfaceServer vision.proto 와 바이트가 같다', () => {
    expect(readFileSync(PROTO).equals(readFileSync(UPSTREAM))).toBe(true)
  })

  it('서비스 ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv(s 셋)에 시험이 쓰는 RPC 둘이 있고 필드 이름이 그대로다', () => {
    const def = require('@grpc/proto-loader').loadSync(PROTO, { keepCase: true, defaults: true, longs: Number })
    const service = def['ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv']
    expect(service).toBeTruthy()
    expect(service.RequestVision.path).toBe('/ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv/RequestVision')
    expect(service.RequestOcr.path).toBe('/ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv/RequestOcr')
    const fields = (name) => def[`ImageProcesssingGrpcSrv.${name}`].type.field.map((f) => f.name)
    expect(fields('VisionRequest')).toEqual(['sourceImage', 'trainImage', 'param'])
    expect(fields('SearchMaxParam')).toEqual(['AcceptThreshold', 'MaximumNumberToFind', 'Timeout', 'TimeoutEnabled'])
    expect(fields('SearchMaxResult')).toEqual(['success', 'Score', 'TX', 'TY'])
    expect(fields('OcrParam')).toEqual(['OcrValueType', 'OcrOperation', 'TextValue', 'MinMatchingValue', 'NumberValue', 'NumberRangeMin', 'NumberRangeMax'])
    expect(fields('OcrResult')).toEqual(['IsAccepted', 'FoundResult', 'Confidence', 'TX', 'TY'])
  })
})
