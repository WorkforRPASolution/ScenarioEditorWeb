import { test, expect } from '@playwright/test'
import { asUser, openFromDialog } from './helpers'
import { COMMAND_CONTROL_URL } from '../env.js'

// P5 시험 실행(설계 §4, §11 E2E). 길: 화면 → 웹 백엔드 → InterfaceServer(/EARS/Action) → CommandServer 흉내(tools/infra/fake-command-control-server.js —
// 설정이 띄운다. 3195 에서 /EARS/Trigger 를 받고, 켜면 실제 규칙대로 로컬 EQP_AUTO_RECOVERY 에 SEWT_ 설비의 실행 기록을 넣는다).
// 시험 데이터: SEWCVD/SEWMODELA 설비 여섯(SEWT_CVD_OFF 는 자동조치 OFF), 시나리오 RUN_PROPS(시작 지연 30초·재시도 2회·후속·메일 생략)·ALL_CONDITIONS,
// SEWCVD/SEWMODELB 의 DUP_PROPERTY·NO_REDIS_FIELD, SEWETCH/SEWMODELB 의 DISABLED. 시나리오·스텝은 아무것도 저장하지 않는다.
// 시험마다 흉내의 제어 값·받은 요청, SEWT_ 실행 기록·요청 기록을 비운다(요청 기록이 남으면 "방금 요청함" 이 다음 시험을 막는다).
const control = async (method, path, body) => {
  const res = await fetch(`${COMMAND_CONTROL_URL}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error(`command control ${method} ${path} → ${res.status}`)
  return res.json()
}
test.beforeEach(async () => { await control('PUT', '/server/on'); await control('POST', '/reset') })
test.afterAll(async () => {
  await control('PUT', '/server/on')
  await control('POST', '/reset')
  expect(await control('GET', '/left')).toEqual({ recoveries: 0, testRuns: 0 })
})

const tid = (page, id) => page.getByTestId(id)
const eqpRow = (page, id) => page.locator(`[data-testid="se-run-row"][data-id="${id}"]`)
const resultRow = (page, id) => page.locator(`[data-testid="se-run-result-row"][data-id="${id}"]`)
// 글자로 찾는 선택 상자: 칸에 들어가 치고 Enter(맞는 첫 줄)
async function pick(page, id, text) {
  await tid(page, id).click()
  await tid(page, id).fill(text)
  await page.keyboard.press('Enter')
}
const options = (page, id) => tid(page, `${id}-option`).evaluateAll((els) => els.map((e) => e.dataset.value))

test('① 시나리오를 열지 않은 채 창에서 공정·모델·시나리오와 설비를 골라 실행 → 설비별 결과와 실행 상태 → 다시 고르기는 방금 요청한 설비를 막는다', async ({ page }) => {
  test.setTimeout(240_000)
  await asUser(page, 'sew_multi')
  await page.goto('/')
  // 시나리오를 열지 않아도 버튼이 켜져 있다
  await expect(tid(page, 'se-bar-id')).toHaveCount(0)
  await expect(tid(page, 'se-run-open')).toBeEnabled()
  await tid(page, 'se-run-open').click()
  await expect(tid(page, 'se-run')).toBeVisible()
  await expect(tid(page, 'se-run-empty')).toHaveText('공정과 모델을 고르면 설비가 보입니다.')
  await expect(tid(page, 'se-run-model')).toBeDisabled()
  await expect(tid(page, 'se-run-go')).toBeDisabled()

  // 공정: 글자를 치면 좁혀지고 Enter 로 고른다(내 공정은 SEWCVD·SEWETCH)
  await tid(page, 'se-run-process').click()
  expect(await options(page, 'se-run-process')).toEqual(['SEWCVD', 'SEWETCH'])
  await tid(page, 'se-run-process').fill('cv')
  expect(await options(page, 'se-run-process')).toEqual(['SEWCVD'])
  await page.keyboard.press('Enter')
  await expect(tid(page, 'se-run-process')).toHaveValue('SEWCVD')
  // 모델: ↑↓ 와 Enter
  await tid(page, 'se-run-model').click()
  expect(await options(page, 'se-run-model')).toEqual(['SEWMODELA', 'SEWMODELB'])
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'se-run-model')).toHaveValue('SEWMODELA')
  // 설비는 모델을 고르면 바로 보인다 — 자동조치 OFF 설비는 흐리고 고를 수 없다
  await expect(tid(page, 'se-run-row')).toHaveCount(6)
  await expect(eqpRow(page, 'SEWT_CVD_OFF')).toHaveAttribute('data-off', 'true')
  await expect(eqpRow(page, 'SEWT_CVD_OFF')).toContainText('실행하지 않습니다')
  await expect(eqpRow(page, 'SEWT_CVD_OFF').locator('input')).toBeDisabled()
  // 설비 표가 옆으로 넘치지 않는다(IP 가 둘인 설비·OFF 안내가 있어도 "방금 요청" 칸까지 보인다)
  expect(await page.locator('.se-run-tbl').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  // 시나리오: 글자로 좁힌다
  await tid(page, 'se-run-scenario').click()
  await tid(page, 'se-run-scenario').fill('run_')
  expect(await options(page, 'se-run-scenario')).toEqual(['RUN_BAD_CATEGORY', 'RUN_PROPS'])
  await tid(page, 'se-run-scenario').fill('run_p')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'se-run-target')).toContainText('SEWCVD-SEWMODELA-RUN_PROPS')
  await expect(tid(page, 'se-run-target')).toContainText('3 스텝')
  await expect(tid(page, 'se-run-note')).toHaveText('설비에 배포된 현재 판이 돕니다.')
  // 운영 속성(읽기 전용)
  const props = tid(page, 'se-run-props')
  for (const s of ['30초', '요청 뒤 30초가 지나야 시작합니다', '2회 · 10초 간격', '성공 → ALL_ACTIONS · 실패 → ALL_CONDITIONS', '성공·중지일 때']) await expect(props).toContainText(s)
  await expect(tid(page, 'se-run-step-range')).toHaveText('1 ~ 3')

  // 설비 고르기: 검색·줄·Ctrl·OFF 줄은 눌러도 그대로
  await tid(page, 'se-run-search').fill('10.99.2')
  await expect(tid(page, 'se-run-row')).toHaveCount(1)
  await tid(page, 'se-run-search').fill('')
  await eqpRow(page, 'SEWT_CVD_A01').click()
  await eqpRow(page, 'SEWT_CVD_A02').click({ modifiers: ['ControlOrMeta'] })
  await eqpRow(page, 'SEWT_CVD_OFF').click({ force: true })
  await expect(tid(page, 'se-run-count')).toHaveText('2대 고름 · 전체 6대')
  // 시작 스텝·사유 검사
  await tid(page, 'se-run-step').fill('4')
  await expect(tid(page, 'se-run-step-error')).toHaveText('시작 스텝은 1 ~ 3 사이여야 합니다.')
  await expect(tid(page, 'se-run-go')).toBeDisabled()
  await tid(page, 'se-run-step').fill('2')
  await tid(page, 'se-run-reason-other').check()
  await expect(tid(page, 'se-run-go')).toBeDisabled()
  await tid(page, 'se-run-reason-text').fill('밸브 "A" 점검')
  await expect(tid(page, 'se-run-summary')).toHaveText('RUN_PROPS · 설비 2대 · 시작 스텝 2 · 밸브 "A" 점검')
  // 결과 메일 수신인: 이 시나리오의 수신 규칙이 가리키는 묶음과 주소(빈 주소는 빠진다), 메일을 생략하는 결과
  await expect(tid(page, 'se-run-mail-group')).toHaveText([/설비 2대 → SEW-RUN-NIGHT/])
  await expect(tid(page, 'se-run-mail')).toContainText('sew.night@example.com · sew.lead@example.com')
  await expect(tid(page, 'se-run-mail')).toContainText('성공·중지일 때는 메일을 보내지 않는 시나리오입니다.')

  // 실행 → 확인 → 결과. 흉내는 22초 뒤에 실행 기록을 넣는다(늦게 등록되는 기록)
  await control('PUT', '/control', { record: true, recordDelayMs: 22_000 })
  await tid(page, 'se-run-go').click()
  await expect(tid(page, 'se-run-confirm-title')).toHaveText('설비 2대에 RUN_PROPS 을 2번 스텝부터 실행합니다')
  await expect(tid(page, 'se-run-confirm')).toContainText('실제 설비에서 동작합니다.')
  await expect(tid(page, 'se-run-confirm-cancel')).toBeFocused()
  await tid(page, 'se-run-confirm-ok').click()
  await expect(tid(page, 'se-run-progress')).toHaveText('다 보냈습니다 2 / 2')
  await expect(tid(page, 'se-run-result-row')).toHaveCount(2)
  await expect(tid(page, 'se-run-outcome')).toHaveText(['요청 접수', '요청 접수'])
  await expect(tid(page, 'se-run-result-summary')).toHaveText('요청 접수 2 · 보내지 않음 0 · 실패 0 · 모름 0')
  // CommandServer 가 받은 것: 설비 ID 순, 라인 ID, 서버가 채운 @UserInfo, 따옴표가 든 사유 그대로
  const calls = await control('GET', '/calls')
  expect(calls.map((c) => [c.headers.eqpid, c.headers.code, c.headers.line, c.headers.triggeredBy])).toEqual([['SEWT_CVD_A01', 'RUN_PROPS', 'SEWLINE1', 'SE'], ['SEWT_CVD_A02', 'RUN_PROPS', 'SEWLINE1', 'SE']])
  expect(JSON.parse(calls[0].body)).toEqual({ '@UserInfo': 'SEW 여러 공정 - sew_multi', '@StartStep': '2', UserText: '밸브 "A" 점검' })
  // 실행 상태: 등록 확인 중 → (20초 뒤) 아직 기록 없음 → 기록이 생기면 시작 대기(30초 지연)
  const state = (id) => resultRow(page, id).getByTestId('se-run-state')
  await expect(state('SEWT_CVD_A01')).toHaveText('등록 확인 중')
  await expect(state('SEWT_CVD_A01')).toHaveText('아직 기록 없음 — 늦게 등록될 수 있습니다', { timeout: 30_000 })
  await expect(state('SEWT_CVD_A01')).toHaveText('시작 대기(30초 지연)', { timeout: 30_000 })
  await expect(state('SEWT_CVD_A02')).toHaveText('시작 대기(30초 지연)', { timeout: 30_000 })
  // 상태가 바뀐다(에이전트가 없으니 흉내가 바꾼다)
  await control('PUT', '/status', { eqpid: 'SEWT_CVD_A01', status: 'StartScenario' })
  await expect(state('SEWT_CVD_A01')).toHaveText('실행 중')
  await control('PUT', '/status', { eqpid: 'SEWT_CVD_A01', status: 'Success' })
  await control('PUT', '/status', { eqpid: 'SEWT_CVD_A02', status: 'NotStarted' })
  await expect(state('SEWT_CVD_A01')).toHaveText('성공')
  await expect(state('SEWT_CVD_A02')).toHaveText('시작 못 함 — 에이전트가 꺼져 있거나 닿지 않음')
  await expect(resultRow(page, 'SEWT_CVD_A01')).toContainText(/\d{2}:\d{2}:\d{2}/)

  // [다시 고르기]: 접수된 설비의 선택이 풀려 있고, 설비 표에 방금 요청이 보인다
  await tid(page, 'se-run-again').click()
  await expect(tid(page, 'se-run-count')).toHaveText('0대 고름 · 전체 6대')
  await expect(eqpRow(page, 'SEWT_CVD_A01')).toContainText('sew_multi')
  // 다시 골라 보내도 방금 요청한 설비는 나가지 않는다(확인 창이 알린다 — 체크 칸은 꺼져 있다)
  await eqpRow(page, 'SEWT_CVD_A01').click()
  await eqpRow(page, 'SEWT_DUP01').click({ modifiers: ['ControlOrMeta'] })
  await tid(page, 'se-run-go').click()
  await expect(tid(page, 'se-run-confirm-recent')).toContainText('1대는 방금 요청했습니다.')
  await expect(tid(page, 'se-run-confirm-again')).not.toBeChecked()
  await tid(page, 'se-run-confirm-ok').click()
  await expect(tid(page, 'se-run-progress')).toHaveText('다 보냈습니다 2 / 2')
  await expect(resultRow(page, 'SEWT_CVD_A01').getByTestId('se-run-outcome')).toHaveText('방금 요청함')
  await expect(resultRow(page, 'SEWT_DUP01').getByTestId('se-run-outcome')).toHaveText('요청 접수')
  expect((await control('GET', '/calls')).map((c) => c.headers.eqpid)).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_DUP01'])
  // 닫았다 다시 열면 마지막 결과가 보인다
  await tid(page, 'se-run-close').click()
  await expect(tid(page, 'se-run')).toHaveCount(0)
  await tid(page, 'se-run-open').click()
  await expect(tid(page, 'se-run-result-row')).toHaveCount(2)
})

test('② 연 시나리오가 미리 골라진다 · 모델을 바꾸면 시나리오·설비 선택이 비워진다 · 실행할 수 없는 시나리오의 표시와 까닭 · CommandServer 가 없으면 세 번 뒤 멈춘다 · 저장하지 않은 고침 안내', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.goto('/')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await tid(page, 'se-run-open').click()
  // 편집기에 연 시나리오가 미리 골라져 있다 — 현재 판 그대로라 그 번호 스텝의 설명이 보인다
  await expect(tid(page, 'se-run-process')).toHaveValue('SEWCVD')
  await expect(tid(page, 'se-run-model')).toHaveValue('SEWMODELA')
  await expect(tid(page, 'se-run-scenario')).toHaveValue('ALL_CONDITIONS')
  await expect(tid(page, 'se-run-target')).toContainText('4 스텝')
  await expect(tid(page, 'se-run-step-desc')).toHaveText('1번 스텝: Reset 누르기')
  await expect(tid(page, 'se-run-row')).toHaveCount(6)
  await eqpRow(page, 'SEWT_CVD_A01').click()
  await expect(tid(page, 'se-run-go')).toBeEnabled()

  // 모델을 바꾸면 시나리오와 설비 선택이 비워진다
  await pick(page, 'se-run-model', 'modelb')
  await expect(tid(page, 'se-run-scenario')).toHaveValue('')
  await expect(tid(page, 'se-run-row')).toHaveCount(1)
  await expect(tid(page, 'se-run-count')).toHaveText('0대 고름 · 전체 1대')
  await expect(tid(page, 'se-run-go')).toBeDisabled()
  // 시나리오 항목의 표시: 확인 필요(같은 키 문서 둘)·현재 판 없음
  await tid(page, 'se-run-scenario').click()
  const marks = await tid(page, 'se-run-scenario-option').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.value, e.querySelector('em')?.textContent ?? ''])))
  expect(marks.DUP_PROPERTY).toBe('확인 필요')
  expect(marks.NO_REDIS_FIELD).toBe('현재 판 없음')
  expect(marks.BAD_VALUES).toBe('')
  // 고를 수는 있고, 고르면 까닭이 위에 붉게 보인다 — [실행] 은 꺼진다
  await tid(page, 'se-run-scenario').fill('dup')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'se-run-block')).toContainText('운영 속성 문서가 하나가 아니거나')
  await eqpRow(page, 'SEWT_CVD_B01').click()
  await expect(tid(page, 'se-run-go')).toBeDisabled()
  // 꺼진 시나리오
  await pick(page, 'se-run-process', 'etch')
  await pick(page, 'se-run-model', 'modelb')
  await tid(page, 'se-run-scenario').click()
  await expect(page.locator('[data-testid="se-run-scenario-option"][data-value="DISABLED"] em')).toHaveText('꺼짐')
  await tid(page, 'se-run-scenario').fill('disabled')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'se-run-block')).toHaveText('이 시나리오는 꺼져 있어 실행할 수 없습니다. 켠 뒤 다시 고르세요.')
  await expect(tid(page, 'se-run-props')).toContainText('꺼짐')

  // CommandServer 가 없으면 접수 여부를 모른다 — 연달아 세 번이면 남은 설비를 보내지 않고 멈춘다
  await pick(page, 'se-run-process', 'cvd')
  await pick(page, 'se-run-model', 'modela')
  await pick(page, 'se-run-scenario', 'all_cond')
  await tid(page, 'se-run-all').check()
  await expect(tid(page, 'se-run-count')).toHaveText('5대 고름 · 전체 6대')
  await control('PUT', '/server/off')
  await tid(page, 'se-run-go').click()
  await tid(page, 'se-run-confirm-ok').click()
  await expect(tid(page, 'se-run-halt')).toHaveText('접수 여부를 모르는 설비가 연달아 세 대라 멈췄습니다. 남은 설비는 보내지 않았습니다.')
  await expect(tid(page, 'se-run-outcome')).toHaveText(['접수 여부 모름', '접수 여부 모름', '접수 여부 모름', '보내지 않음', '보내지 않음'])
  await expect(tid(page, 'se-run-progress')).toHaveText('멈췄습니다 5 / 5')
  await expect(tid(page, 'se-run-result-summary')).toHaveText('요청 접수 0 · 보내지 않음 2 · 실패 0 · 모름 3')
  await control('PUT', '/server/on')
  // [다시 고르기]: 모름이었던 세 대의 선택이 풀리고 보내지 않은 두 대만 남는다
  await tid(page, 'se-run-again').click()
  await expect(tid(page, 'se-run-count')).toHaveText('2대 고름 · 전체 6대')
  await tid(page, 'se-run-close').click()

  // 편집기에서 고치고 저장하지 않았으면: 고침 안내, 시작 스텝이 1 이 아니면 번호 경고
  await tid(page, 'se-bar-description').fill('고친 제목')
  await expect(tid(page, 'se-bar-unsaved')).toBeVisible()
  await tid(page, 'se-run-open').click()
  await expect(tid(page, 'se-run-scenario')).toHaveValue('ALL_CONDITIONS')
  await expect(tid(page, 'se-run-note')).toHaveText('편집기에서 고친 내용은 저장하지 않아 시험되지 않습니다. 설비에는 배포된 현재 판이 돕니다.')
  await expect(tid(page, 'se-run-step-desc')).toHaveCount(0)
  await tid(page, 'se-run-step').fill('2')
  await expect(tid(page, 'se-run-step-warn')).toHaveText('현재 판의 2번 스텝부터 돕니다. 편집기의 2번과 다를 수 있습니다.')
})

test('③ 쓰기 권한이 없는 사용자는 버튼이 꺼져 있고 까닭이 보인다', async ({ page }) => {
  await asUser(page, 'sew_cvd')
  await page.goto('/')
  await expect(tid(page, 'se-run-open')).toBeDisabled()
  await expect(tid(page, 'se-run-open')).toHaveAttribute('title', 'WRITE 권한이 없어 시험 실행을 할 수 없습니다.')
})
