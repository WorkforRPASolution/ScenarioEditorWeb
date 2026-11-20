import { describe, it, expect, vi } from 'vitest'
import { webManagerDbEnabled, connectEarsOnly, connectWebDbOnly, disableWebManagerLog, healthWithoutWebManager } from '../webManagerDb'
import { webManagerConnection } from '../shared/db/connection'
import { WebManagerLog, createErrorLog } from '../shared/models/webmanagerLogModel'

const health = (ears, redis = 'ok') => ({
  status: 'down',
  podId: 'p',
  timestamp: 't',
  components: {
    mongodb: { status: 'down', ears, webManager: 'down' },
    redis_db0: { status: redis },
    redis_db10_eqp: { status: 'disabled' }
  }
})

describe('WEBMANAGER DB 스위치 (사내 운영 EARS 읽기 시험)', () => {
  it('SE_WEBMANAGER_DB 가 0 일 때만 끈다', () => {
    expect(webManagerDbEnabled({})).toBe(true)
    expect(webManagerDbEnabled({ SE_WEBMANAGER_DB: '1' })).toBe(true)
    expect(webManagerDbEnabled({ SE_WEBMANAGER_DB: '0' })).toBe(false)
  })

  it('EARS 만 단독판 접속 이름으로, 색인을 만들지 않고 연결한다', async () => {
    const conn = { openUri: vi.fn(async () => {}), on: vi.fn() }
    await connectEarsOnly(conn, { MONGODB_URI: 'mongodb://h:27017/EARS' })
    expect(conn.openUri).toHaveBeenCalledWith(
      'mongodb://h:27017/EARS',
      expect.objectContaining({ autoIndex: false, appName: 'ScenarioEditorWeb' })
    )
  })

  it('연결 실패는 던져서 서버가 뜨지 않게 한다', async () => {
    const conn = { openUri: vi.fn(async () => { throw new Error('auth failed') }), on: vi.fn() }
    await expect(connectEarsOnly(conn, {})).rejects.toThrow('auth failed')
  })

  it('기록 저장을 끄면 오류 기록이 WEBMANAGER 연결 없이 바로 끝난다', async () => {
    disableWebManagerLog({ WebManagerLog })
    await expect(createErrorLog({ errorType: 'ApiError', errorMessage: '시험' })).resolves.toBeTruthy()
    expect(webManagerConnection.readyState).toBe(0)
  }, 3000)

  it('상태 확인은 EARS 기준이고 WEBMANAGER 는 disabled 로 보인다', () => {
    expect(healthWithoutWebManager(health('ok'))).toMatchObject({
      status: 'ok',
      podId: 'p',
      components: { mongodb: { status: 'ok', ears: 'ok', webManager: 'disabled' }, redis_db0: { status: 'ok' } }
    })
    expect(healthWithoutWebManager(health('down')).status).toBe('down')
    expect(healthWithoutWebManager(health('ok', 'down')).status).toBe('degraded')
  })
})

describe('웹 전용 DB 만 연결 (SE_WEBMANAGER_DB=0)', () => {
  it('SE_WEB_DB_URI 가 있으면 단독판 접속 이름으로 연다', async () => {
    const conn = { openUri: vi.fn(async () => {}), on: vi.fn() }
    const ok = await connectWebDbOnly(conn, { SE_WEBMANAGER_DB: '0', SE_WEB_DB_URI: 'mongodb://h:27017/SE_WEB' })
    expect(ok).toBe(true)
    expect(conn.openUri).toHaveBeenCalledWith('mongodb://h:27017/SE_WEB', { appName: 'ScenarioEditorWeb', maxPoolSize: 5, autoIndex: false })
  })

  it('웹 전용 DB 이름이 운영 EARS DB 이름과 같으면(대소문자 무시) 열지 않고 던져 서버가 뜨지 않게 한다', async () => {
    const conn = { openUri: vi.fn(async () => {}), on: vi.fn() }
    const env = { SE_WEBMANAGER_DB: '0', MONGODB_URI: 'mongodb://u:p@prod:27017/EARS?authSource=admin', SE_WEB_DB_URI: 'mongodb://u:p@prod:27017/ears' }
    await expect(connectWebDbOnly(conn, env)).rejects.toThrow('SE_WEB_DB_URI')
    // MONGODB_URI 가 없으면 연결 코드의 기본값(EARS)과 비교한다
    await expect(connectWebDbOnly(conn, { SE_WEBMANAGER_DB: '0', SE_WEB_DB_URI: 'mongodb://localhost:27017/EARS' })).rejects.toThrow('운영 EARS')
    expect(conn.openUri).not.toHaveBeenCalled()
  })

  it('웹 전용 DB 주소에 DB 이름이 없으면 열지 않고 던진다 — 드라이버가 test DB 에 쓰지 않게 서버가 뜨지 않는다(SEW-024)', async () => {
    const conn = { openUri: vi.fn(async () => {}), on: vi.fn() }
    for (const uri of ['mongodb://u:p@prod:27017', 'mongodb://u:p@prod:27017/', 'mongodb://u:p@prod:27017/?authSource=admin']) {
      await expect(connectWebDbOnly(conn, { SE_WEBMANAGER_DB: '0', SE_WEB_DB_URI: uri }), uri).rejects.toThrow('DB 이름이 없습니다')
    }
    expect(conn.openUri).not.toHaveBeenCalled()
  })

  it('주소가 없거나 SE_WEBMANAGER_DB 가 0 이 아니면 열지 않는다', async () => {
    const conn = { openUri: vi.fn(async () => {}), on: vi.fn() }
    expect(await connectWebDbOnly(conn, { SE_WEBMANAGER_DB: '0' })).toBe(false)
    expect(await connectWebDbOnly(conn, { SE_WEB_DB_URI: 'mongodb://h/x' })).toBe(false)
    expect(conn.openUri).not.toHaveBeenCalled()
  })
})
