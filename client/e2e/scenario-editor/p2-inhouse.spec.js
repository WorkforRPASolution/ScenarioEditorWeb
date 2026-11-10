import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, rowOf, cellOf, toast, selectRow, menu } from './helpers'
import { CVD, SOURCE, sewName, idOf, urlOf, apiAs, proxyMode, db, cleanup, leftovers, NONE_LEFT, closeDb } from './sew'

// 사내 쓰기 시험(2026-11-10)에서 나온 요청을 실제 화면으로 확인한다 — 단위 시험만 있던 것들.
// 시드 시나리오(ALL_CONDITIONS·ALL_ACTIONS)는 읽기만 하고, 배포는 SEW_W_ 시나리오에만 한다(p2-save 와 같은 정리).
// ALL_ACTIONS: 4 휠 · 5 키보드(RESET + Enter·Tab) · 11 창 찾기(EQ Control*) · 14 스크립트(recover.scs), 서버 uid s0…s17.
const ACTIONS = { ...CVD, name: 'ALL_ACTIONS' }
const save = (page) => page.getByTestId('se-save-dialog')
const change = (page, text) => page.getByTestId('se-save-change').filter({ hasText: text })
const panel = (page) => page.getByTestId('se-detail')
// 색이 들어간 조각만(이전 = del, 지금 = ins)
const marks = async (loc) => ({ del: await loc.locator('del').allInnerTexts(), ins: await loc.locator('ins').allInnerTexts() })
const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
const color = (loc) => loc.evaluate((el) => getComputedStyle(el).color)
const isReddish = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return r > 150 && g < 110 && b < 110 }
const CLEAR = 'rgba(0, 0, 0, 0)'

async function openSave(page) {
  await page.getByTestId('se-save').click()
  await expect(save(page)).toBeVisible()
}
async function openLoadAt(page, k) {
  await page.getByTestId('se-load').click()
  const dlg = page.getByTestId('se-load-dialog')
  await dlg.getByTestId('se-load-process').selectOption(k.process)
  await dlg.getByTestId('se-load-model').selectOption(k.model)
  return dlg
}
// 불러오기 목록 한 줄의 칸 글(col-id → 글). 고정 열(확인 필요)은 다른 상자에 있어 줄 번호로 모은다
const loadRow = (dlg, name) => dlg.getByTestId('se-load-grid').evaluate((grid, n) => {
  const cell = [...grid.querySelectorAll('.ag-center-cols-container [col-id="name"]')].find((c) => c.innerText.trim() === n)
  if (!cell) return null
  const index = cell.closest('.ag-row').getAttribute('row-index')
  const out = {}
  for (const c of grid.querySelectorAll(`.ag-row[row-index="${index}"] .ag-cell`)) out[c.getAttribute('col-id')] = c.innerText.trim()
  return out
}, name)

let api
test.beforeAll(async () => {
  api = await apiAs('sew_master')
  await cleanup()
})
test.afterEach(async () => {
  try {
    await proxyMode('pass')
  } finally {
    await cleanup()
  }
})
test.afterAll(async () => {
  try {
    expect(await leftovers()).toEqual(NONE_LEFT)
  } finally {
    await api?.dispose()
    await closeDb()
  }
})

test('① 새 시나리오에서 운영 속성을 끄고 저장 창을 열면 바뀐 것에 칸 이름과 이전 → 지금', async ({ page }) => {
  const NEW = { ...CVD, name: sewName('NEWP') }
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)
  await page.getByTestId('se-new').click()
  const dlg = page.getByTestId('se-new-dialog')
  await dlg.getByTestId('se-new-model').selectOption(CVD.model)
  await dlg.getByTestId('se-new-type').selectOption('1')
  await dlg.getByTestId('se-new-name').fill(NEW.name)
  await dlg.getByTestId('se-new-mail').fill('E2E 사내 요청')
  await dlg.getByTestId('se-new-create').click()
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(NEW))

  // 운영 속성 창에서 끄고 시작 지연·재시도를 바꾼다 — 창 바닥의 "바뀐 값" 도 이름과 이전 → 지금
  await page.getByTestId('se-property').click()
  const prop = page.getByTestId('se-property-dialog')
  await prop.getByTestId('se-prop-edit').click()
  await prop.getByTestId('se-prop-onoff').click()
  await expect(prop.getByTestId('se-prop-onoff')).toHaveAttribute('aria-checked', 'false')
  await prop.locator('[data-pfield="StartDelay"]').fill('120')
  await prop.locator('[data-pfield="RetryCnt"]').selectOption('2')
  await expect(prop.getByTestId('se-prop-foot')).toContainText('상태 켜짐 → 꺼짐, 시작 지연 없음 → 2분, 재시도 안 함 → 2번 더')
  await prop.getByTestId('se-prop-apply').click()
  await expect(toast(page)).toContainText('적용했습니다')
  await prop.getByLabel('닫기').click()

  // 저장 창 "바뀐 것": 전에는 칸 이름만(켜짐) 나와 값으로 읽혔다
  await openSave(page)
  const row = change(page, '운영 속성')
  await expect(row).toContainText('상태 켜짐 → 꺼짐 · 시작 지연 없음 → 2분 · 재시도 안 함 → 2번 더')
  expect(await marks(row)).toEqual({ del: [], ins: [] }) // 통째로 바뀐 값에는 색이 없다
})

test('② 글의 일부만 바꾸면 스텝 패널·저장 창에서 그 부분만 색으로(키보드 입력·스크립트 설정·창 찾기)', async ({ page }) => {
  // ALL_ACTIONS 는 FAP 스텝 때문에 복사 배포가 막힌다 — 시드를 열어 화면에서만 고친다(배포·초안 저장 없음, 서버에는 아무것도 쓰지 않는다)
  await asUser(page, 'sew_master')
  await page.goto(urlOf(ACTIONS))
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(ACTIONS))
  await expect(rowOf(page, 's13')).toHaveCount(1) // 표는 보이는 줄 둘레만 그린다 — 18줄을 세지 않는다
  const apply = async () => {
    await page.getByTestId('se-panel-apply').click()
    await expect(page.getByTestId('se-panel-apply')).toHaveCount(0)
  }
  const KEY = { text: '키보드 RESET + Enter + Tab → 키보드 RESET_ALL + Enter + Tab', marks: { del: [], ins: ['_ALL'] } }
  const CS = { text: '스크립트 recover.scs → 스크립트 recover_v2.scs · 인자 PM1 · 시간 제한 1분', marks: { del: [], ins: ['_v2', ' · 인자 PM1 · 시간 제한 1분'] } }
  // 시드의 창 찾기 값(EQ Control*)은 풀 수 없는 꼴이라 이전 값이 없음이다
  const FW = { text: '창 찾기 없음 → 창 찾기 EQ Control Main* · 클래스 WindowsForms10', marks: { del: ['없음'], ins: ['EQ Control Main* · 클래스 WindowsForms10'] } }
  const inPanel = async (want) => {
    await expect(panel(page).locator('.se-df')).toHaveText([want.text])
    expect(await marks(panel(page))).toEqual(want.marks)
  }

  // 5번 키보드: 글자 뒤에 덧붙인다
  await selectRow(page, 's4')
  await panel(page).locator('[data-field="key"]').fill('RESET_ALL')
  await inPanel(KEY)
  await apply()
  // 14번 스크립트: 이름 가운데 + 인자 + 시간 제한
  await selectRow(page, 's13')
  await panel(page).locator('[data-field="script"]').fill('recover_v2.scs')
  await panel(page).getByTestId('se-cs-arg-add').click()
  await panel(page).locator('[data-cs-arg="0"]').fill('PM1')
  await panel(page).getByTestId('se-cs-timeout-on').check()
  await inPanel(CS)
  await apply()
  // 11번 창 찾기: 제목 + 클래스
  await selectRow(page, 's10')
  await panel(page).locator('[data-field="fw"]').fill('EQ Control Main*')
  await panel(page).getByTestId('se-fw-class').fill('WindowsForms10')
  await inPanel(FW)
  await apply()

  await openSave(page)
  for (const [no, want] of [['5번', KEY], ['14번', CS], ['11번', FW]]) {
    await expect(change(page, no)).toContainText(`동작 ${want.text}`)
    expect(await marks(change(page, no)), no).toEqual(want.marks)
  }
  // 색: 지금 = 초록 바탕, 이전 = 붉은 바탕(바탕이 실제로 칠해진다)
  expect(await bg(change(page, '5번').locator('ins').first())).not.toBe(CLEAR)
  expect(await bg(change(page, '11번').locator('del').first())).not.toBe(CLEAR)
  expect(await bg(change(page, '5번').locator('ins').first())).not.toBe(await bg(change(page, '11번').locator('del').first()))
})

test('③ 다른 탭에서 껐다 다시 켠 뒤(값 차이 없음) 배포하면 운영 속성 충돌을 묻지 않는다', async ({ page }) => {
  const P = { ...CVD, name: sewName('SAME') }
  await api.deployFrom(SOURCE, P)
  await asUser(page, 'sew_master')
  await page.goto(urlOf(P))
  await expect(rows(page)).toHaveCount(4)

  // 다른 탭: 불러오기 창 스위치로 껐다가 다시 켠다 — 운영 속성 문서는 두 번 바뀌었지만(수정자 기록) 값은 이 화면과 같다
  const other = await page.context().newPage()
  await asUser(other, 'sew_master')
  await other.goto('/scenario-editor')
  const dlg = await openLoadAt(other, P)
  await dlg.getByTestId('se-load-search').fill(P.name)
  await dlg.getByRole('gridcell', { name: P.name, exact: true }).click()
  const sw = other.getByTestId('se-load-switch')
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await other.close()
  expect((await api.open(P)).edited.property.IsEnabled).toBe(true)

  await page.getByTestId('se-bar-description').fill('E2E 값 차이 없음')
  await openSave(page)
  await expect(page.getByTestId('se-save-deploy')).toBeEnabled()
  await expect(page.getByTestId('se-save-conflict')).toHaveCount(0)
  await expect(page.getByTestId('se-save-force')).toHaveCount(0)
  await page.getByTestId('se-save-deploy').click()
  await page.getByTestId('se-save-go').click()
  await expect(page.getByTestId('se-save-result').locator('h4')).toHaveText(/설비에 배포했습니다/, { timeout: 60_000 })
  const now = await api.open(P)
  expect(now.edited.header.description).toBe('E2E 값 차이 없음')
  expect(now.edited.property.IsEnabled).toBe(true)
})

test('④ 불러오기 목록: 데스크톱 순서의 열·한글 값·넓은 창, 열 수 없는 원인은 확인 필요 열에 붉은 글씨', async ({ page }) => {
  const L = { ...CVD, name: sewName('LIST') }
  await api.deployFrom(SOURCE, L, (sc) => {
    Object.assign(sc.property, { IsEnabled: false, StartDelay: 120, RetryCnt: 2, RetryInterval: 30, DoNotSendEmailWhenSuccess: true, DoNotSendEmailWhenStop: true })
  })
  // 트리거 정보는 성과 문서의 값이다(웹은 고치지 않는다) — 시험 시나리오에 직접 넣는다
  const { ears } = await db()
  await ears.db().collection('SC_PROPERTY').updateOne({ process: L.process, eqpModel: L.model, scname: L.name }, { $set: { 'performance.TriggerInfo': 'ALARM 1234 / E2E 트리거 정보' } })

  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  const dlg = await openLoadAt(page, L)
  // 창 너비: 화면의 94%(최대 1800)
  const box = await dlg.locator('> div').nth(1).boundingBox()
  const vw = page.viewportSize().width
  expect(Math.round(box.width)).toBe(Math.min(1800, Math.round(vw * 0.94)))
  // 열 순서: 이름·내 초안·트리거·유형·설명·켜짐·스텝 수·용량·트리거 정보·최근 수정자·현재 버전·확인 필요(메일 생략·시작 지연·재시도·등급은 뺐다).
  // 1920 화면에서는 가로로 밀지 않고 다 보인다. 1600 에서는 표가 보이는 열만 그려 왼쪽·오른쪽 끝에서 한 번씩 읽는다
  const ALL = ['이름', '내 초안', '트리거', '유형', '설명', '켜짐', '스텝 수', '용량', '트리거 정보', '최근 수정자', '현재 버전', '확인 필요']
  const heads = () => dlg.locator('.ag-header-cell-text').allInnerTexts()
  const center = dlg.locator('.ag-center-cols-viewport')
  if (vw >= 1920) {
    expect(await heads()).toEqual(ALL)
    expect(await center.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  } else {
    expect((await heads()).slice(0, 8)).toEqual(ALL.slice(0, 8))
    await center.evaluate((el) => { el.scrollLeft = el.scrollWidth })
    await expect.poll(async () => (await heads()).slice(-3)).toEqual(ALL.slice(-3))
    await center.evaluate((el) => { el.scrollLeft = 0 })
  }

  // 스텝 수·용량: 현재 버전 파일에서 온다 — 용량은 그 판 GridFS 파일(기준 화면 묶음)의 길이
  const file = await ears.db().collection('fs.files').findOne({ 'metadata.process': L.process, 'metadata.model': L.model, 'metadata.name': L.name }, { projection: { length: 1 } })
  expect(file.length).toBeGreaterThan(1024)
  await dlg.getByTestId('se-load-search').fill(L.name)
  await expect.poll(() => loadRow(dlg, L.name)).toMatchObject({
    triggerName: 'Log', typeName: '알람자동조치', description: '조건 4종', isEnabled: '꺼짐',
    stepCount: '4', sizeBytes: `${(file.length / 1024).toFixed(1)} KB`, triggerInfo: 'ALARM 1234 / E2E 트리거 정보', status: ''
  })
  await expect(dlg.locator('.ag-cell[col-id="stepCount"]').first()).toHaveClass(/ag-right-aligned-cell/)

  // 열 수 없는 원인(같은 키 2건·현재 버전 없음)은 확인 필요 열에 붉은 글씨, 값이 없는 칸은 빈칸(현재 버전이 없으면 스텝 수·용량도 빈칸)
  await dlg.getByTestId('se-load-search').fill('')
  await dlg.getByTestId('se-load-model').selectOption('SEWMODELB')
  await expect.poll(() => loadRow(dlg, 'DUP_PROPERTY')).toMatchObject({ status: '같은 키 2건', isEnabled: '?', triggerInfo: '' })
  expect(await loadRow(dlg, 'NO_REDIS_FIELD')).toMatchObject({ status: '현재 버전 없음', stepCount: '', sizeBytes: '' })
  const bad = dlg.locator('.ag-cell.se-load-bad')
  await expect(bad).toHaveText(['같은 키 2건', '현재 버전 없음'])
  expect(isReddish(await color(bad.first()))).toBe(true)
})

test('⑤ 새 스텝의 넣을 자리를 바꾸면 표가 그 줄로 스크롤하고 메일 번호도 그 자리를 따른다', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize().width, height: 640 }) // 18줄이 한 화면에 들어가지 않게
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await openFromDialog(page, ACTIONS.process, ACTIONS.model, ACTIONS.name)
  const table = page.getByTestId('se-step-table')
  const inView = (uid) => table.evaluate((el, id) => {
    const row = el.querySelector(`.ag-center-cols-container .ag-row[row-id="${id}"]`)
    const view = el.querySelector('.ag-body-viewport').getBoundingClientRect()
    if (!row) return false
    const r = row.getBoundingClientRect()
    return r.top >= view.top - 1 && r.bottom <= view.bottom + 1
  }, uid)
  const mail = panel(page).locator('em').first()
  await selectRow(page, 's1')
  expect(await inView('s17')).toBe(false)
  await menu(page, 'se-tool-new', '[data-new="none"]')
  const where = page.getByTestId('se-new-where')
  await expect(where).toHaveValue('s1')
  await expect(mail).toHaveText('메일에 "2. …" 로 나옵니다')
  // 맨 끝 → 마지막 줄이 보이고 그 아래에 초록 줄
  await where.selectOption('')
  await expect.poll(() => inView('s17')).toBe(true)
  await expect(rowOf(page, 's17')).toHaveClass(/se-row-ins-after/)
  await expect(mail).toHaveText('메일에 "19. …" 로 나옵니다')
  // 1번 앞 → 첫 줄로 돌아온다
  await where.selectOption('s0')
  await expect.poll(() => inView('s0')).toBe(true)
  await expect(rowOf(page, 's0')).toHaveClass(/se-row-ins-before/)
  await expect(mail).toHaveText('메일에 "1. …" 로 나옵니다')
  // 17번 앞에 넣는다
  await where.selectOption('s16')
  await expect.poll(() => inView('s16')).toBe(true)
  await expect(mail).toHaveText('메일에 "17. …" 로 나옵니다')
  await panel(page).locator('[data-field="desc"]').fill('E2E 넣을 자리')
  await panel(page).locator('[data-field="cmd"]').fill('restart.bat')
  await page.getByTestId('se-new-add').click()
  await expect(page.getByTestId('se-new-where')).toHaveCount(0)
  await expect(cellOf(page, 's16', 'no')).toContainText('18') // 17번 자리에 새 스텝이 들어가 한 칸 밀렸다
  await expect(page.getByTestId('se-step-table').locator('.ag-row[row-index="16"] [col-id="desc"]')).toHaveText('E2E 넣을 자리')
})

// 2026-11-11 사용자 요청: "프로세스명과 모델명 옆에 등록된 시나리오가 몇개인지 () 안에 표시 … WebManager 의 필터처럼",
// "내가 만든 초안이 어디어디 있는지 … ( 1 | 10 ) 이런식이면 시나리오는 10개인데 내가 만든 초안은 1개"
test('⑥ 불러오기 창의 공정·모델 옆 수: 등록된 시나리오 수, 내 초안이 있는 곳은 (내 초안 | 시나리오), [내 초안만] 은 선택 목록도 좁힌다 — 초안을 지우면 돌아온다', async ({ page }) => {
  const T = { ...CVD, name: sewName('COUNT') }
  await api.deployFrom(SOURCE, T)
  await asUser(page, 'sew_master')
  await page.goto(urlOf(T))
  await expect(rows(page)).toHaveCount(4)

  const texts = (dlg, id) => dlg.getByTestId(id).locator('option').allTextContents().then((a) => a.map((x) => x.trim()))
  const values = (dlg, id) => dlg.getByTestId(id).locator('option').evaluateAll((os) => os.map((o) => o.value))
  let dlg = await openLoadAt(page, CVD)
  // 기대값: 모델마다 목록의 줄 수(서버 API), 공정은 그 합
  const models = await values(dlg, 'se-load-model')
  expect(models).toContain(CVD.model)
  const n = {}
  for (const m of models) n[m] = (await api.list(CVD.process, m)).length
  const sum = models.reduce((x, m) => x + n[m], 0)
  expect(n[CVD.model]).toBeGreaterThan(1)
  await expect.poll(() => texts(dlg, 'se-load-model')).toEqual(models.map((m) => `${m} (${n[m]})`))
  const processes = await values(dlg, 'se-load-process')
  const others = (await texts(dlg, 'se-load-process')).filter((_, i) => processes[i] !== CVD.process)
  expect((await texts(dlg, 'se-load-process'))[processes.indexOf(CVD.process)]).toBe(`${CVD.process} (${sum})`)
  for (const x of others) expect(x).toMatch(/^\S+ \(\d+\)$/) // 내 초안이 없는 공정은 시나리오 수만
  await expect(dlg.getByTestId('se-load-count-hint')).toHaveText('괄호 = 시나리오 수, 내 초안이 있는 곳은 (내 초안 | 시나리오)')
  // 고른 값은 이름 그대로다(수가 섞이지 않는다)
  await expect(dlg.getByTestId('se-load-model')).toHaveValue(CVD.model)
  await dlg.locator('[aria-label="닫기"]').click()

  // 바 칸을 고쳐 초안 저장 → 다시 열면 그 공정·모델에만 (1 | N)
  await page.getByTestId('se-bar-description').fill('E2E 수 시험')
  await openSave(page)
  await page.getByTestId('se-save-draft').click()
  await expect(page.getByTestId('se-save-result').locator('h4')).toHaveText(/초안을 저장했습니다/)
  await page.getByTestId('se-save-close').click()
  dlg = await openLoadAt(page, CVD)
  await expect.poll(() => texts(dlg, 'se-load-model')).toEqual(models.map((m) => (m === CVD.model ? `${m} (1 | ${n[m]})` : `${m} (${n[m]})`)))
  const after = await texts(dlg, 'se-load-process')
  expect(after[processes.indexOf(CVD.process)]).toBe(`${CVD.process} (1 | ${sum})`)
  expect(after.filter((_, i) => processes[i] !== CVD.process)).toEqual(others)

  // [내 초안만] 을 켜면 선택 목록도 내 초안이 있는 공정·모델만 — 초안이 없는 곳에서 켜면 초안이 있는 곳으로 옮긴다("내 초안만 보기를 선택할때 초안만 있는 공정, 모델만 보이도록")
  const elsewhere = processes.find((x) => x !== CVD.process)
  await dlg.getByTestId('se-load-process').selectOption(elsewhere)
  await expect(dlg.getByTestId('se-load-scope-hint')).toHaveText('공정 권한 안의 공정·모델만 보입니다')
  await dlg.getByTestId('se-load-draft-only').locator('input').check()
  await expect(dlg.getByTestId('se-load-process')).toHaveValue(CVD.process)
  await expect(dlg.getByTestId('se-load-model')).toHaveValue(CVD.model)
  await expect.poll(() => texts(dlg, 'se-load-process')).toEqual([`${CVD.process} (1 | ${sum})`])
  await expect.poll(() => texts(dlg, 'se-load-model')).toEqual([`${CVD.model} (1 | ${n[CVD.model]})`])
  await expect(dlg.getByTestId('se-load-scope-hint')).toHaveText('[내 초안만] — 내 초안이 있는 공정·모델만 보입니다')
  await expect(dlg.locator('.ag-center-cols-container .ag-row')).toHaveCount(1) // 표에도 내 초안이 있는 줄만
  await expect(dlg.getByRole('gridcell', { name: T.name, exact: true })).toBeVisible()
  await dlg.getByTestId('se-load-draft-only').locator('input').uncheck()
  await expect.poll(() => texts(dlg, 'se-load-process')).toEqual(after)
  await expect(dlg.getByTestId('se-load-model')).toHaveValue(CVD.model)

  // 그 초안을 지우면 다시 묻지 않고 괄호가 시나리오 수만으로 돌아온다
  await dlg.getByTestId('se-load-search').fill(T.name)
  await dlg.getByRole('gridcell', { name: T.name, exact: true }).click()
  await dlg.getByTestId('se-load-draft-line').click()
  await dlg.getByTestId('se-load-draft-delete').click()
  await dlg.getByTestId('se-load-draft-delete-go').click()
  await expect.poll(() => texts(dlg, 'se-load-model')).toEqual(models.map((m) => `${m} (${n[m]})`))
  expect((await texts(dlg, 'se-load-process'))[processes.indexOf(CVD.process)]).toBe(`${CVD.process} (${sum})`)
})
