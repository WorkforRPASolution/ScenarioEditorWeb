import { describe, it, expect } from 'vitest'
import { mongoDbName, sameDbName } from '../../../mongoUri'

describe('Mongo 주소의 DB 이름', () => {
  it.each([
    ['mongodb://u:p@h1:27017,h2:27017/EARS?authSource=admin', 'EARS'],
    ['mongodb+srv://u:p@cluster.example/SE_WEB', 'SE_WEB'],
    ['mongodb://u:p%2Fq@h:27017/EARS', 'EARS'],
    ['mongodb://h:27017/SE%5FWEB', 'SE_WEB'],
    ['  mongodb://h:27017/EARS  ', 'EARS'],
    ['mongodb://h:27017', ''],
    ['mongodb://h:27017/?replicaSet=rs0', ''],
    ['http://h/EARS', ''],
    ['', ''],
    [undefined, '']
  ])('%s → %s', (uri, name) => {
    expect(mongoDbName(uri)).toBe(name)
  })

  it('같은 DB 인지는 경로의 DB 이름으로 보고(쿼리·호스트 무시) 대소문자를 가리지 않는다 — 대소문자만 다른 DB 는 한 서버에 둘 수 없다', () => {
    expect(sameDbName('mongodb://a:27017/EARS?authSource=admin', 'mongodb://b:27017/ears')).toBe(true)
    expect(sameDbName('mongodb://a:27017/EARS', 'mongodb://a:27017/SE_WEB')).toBe(false)
    expect(sameDbName('mongodb://a:27017', 'mongodb://a:27017')).toBe(false) // 이름이 없으면 같다고 하지 않는다(따로 막는다)
  })
})
