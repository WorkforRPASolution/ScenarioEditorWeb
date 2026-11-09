import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, rowAt, rowOf, cellOf, toast, column, selectRow, menu, pickNext } from './helpers'
import { CVD, SOURCE, sewName, idOf, urlOf, apiAs, noUrls, proxyMode, db, cleanup, leftovers, NONE_LEFT, closeDb } from './sew'

// P2-D 저장·관리 흐름(설계 §2 완료 조건 2 저장 → 다시 열기·4 저장 흐름·5 판 관리·운영 속성의 화면 부분).
// 시드 시나리오(basic ALL_CONDITIONS·NEXT_RULES)는 읽기만 한다 — 배포는 SEW_W_<시각>_<화면>_<표시> 시나리오에만 하고, 초안은 웹 전용 DB 에만 쓴다.
// 시험마다 끝나면(실패해도) SEW_W_ 시나리오의 SC_PROPERTY·GridFS·Redis 필드와 시험 사용자의 초안·초안 그림·배포 기록을 지운다(sew.js cleanup).
// InterfaceServer 컨테이너가 떠 있어야 한다. 결과 모름(⑤)은 시험 서버의 InterfaceServer 주소인 고장 주입 중계를 잠깐 slow500 으로 바꾼다.
// ALL_CONDITIONS: 1 이미지(Reset 누르기) · 2 OCR(상태 IDLE 확인) · 3 조건 없음(30초 대기) · 4 설비 상태(서버 상태 확인), 서버 uid s0…s3.

const save = (page) => page.getByTestId('se-save-dialog')
const result = (page) => page.getByTestId('se-save-result')
const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0)

async function openSave(page) {
  await page.getByTestId('se-save').click()
  await expect(save(page)).toBeVisible()
}
// [배포] → 확인(문구) → [배포] → 성공 화면. 새 버전 표시(결과 화면)를 돌려주고 창을 닫는다.
async function deployOk(page, confirmText) {
  const go = page.getByTestId('se-save-deploy')
  await expect(go).toBeEnabled()
  await go.click()
  await expect(page.getByTestId('se-save-confirm')).toContainText(confirmText)
  await page.getByTestId('se-save-go').click()
  return finishOk(page)
}
async function finishOk(page) {
  await expect(result(page).locator('h4')).toHaveText(/설비에 배포했습니다/, { timeout: 60_000 })
  const version = (await result(page).locator('dd').nth(1).innerText()).trim()
  expect(version).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  await page.getByTestId('se-save-close').click()
  await expect(save(page)).toHaveCount(0)
  return version
}
async function expectCurrent(page, k, version) {
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(k))
  await expect(page.getByTestId('se-bar-version')).toContainText('현재 버전')
  if (version) await expect(page.getByTestId('se-bar-version')).toContainText(version)
  await expect(page.getByTestId('se-bar-unsaved')).toHaveCount(0)
}
// 이미지 스텝을 고르면 기준 화면(가운데)과 찾을 그림(패널)이 실제로 그려진다 — 그림 참조가 살아 있다
async function expectImagesOf(page, uid) {
  await selectRow(page, uid)
  await expect.poll(() => loaded(page.getByTestId('se-base-image'))).toBe(true)
  await expect.poll(() => loaded(page.getByTestId('se-detail').locator('[data-station="find"] img').first())).toBe(true)
}
// 저장 기준 판을 다시 읽어(새로고침) 스텝 수·조건·설명을 본다
async function reopen(page, k) {
  await page.reload()
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(k))
  await expect(rows(page)).not.toHaveCount(0)
}

let api
test.beforeAll(async () => {
  api = await apiAs('sew_master')
  await cleanup() // 앞선 실행이 중간에 끊겨 남은 것
})
test.afterEach(async () => {
  try {
    await proxyMode('pass') // ⑤ 가 중간에 실패해도 다음 시험은 그대로 중계
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

test('① 스텝 한 곳·바 칸을 고쳐 초안 저장 → 새로고침 → 불러오기 [초안 이어서 열기] → 같은 스텝·참조·바 값', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)
  await pickNext(page, 's0', 'onFalse', 's2')
  await expect(cellOf(page, 's0', 'onFalse')).toHaveText('→3')
  await page.getByTestId('se-bar-description').fill('E2E 초안 메일 제목')
  await page.getByTestId('se-bar-timeout').fill('75')
  await expect(page.getByTestId('se-bar-unsaved')).toHaveText('저장 전 3곳 바뀜')

  await openSave(page)
  const draft = page.getByTestId('se-save-draft')
  await expect(draft).toBeEnabled()
  await draft.click()
  await expect(result(page).locator('h4')).toHaveText(/초안을 저장했습니다/)
  await page.getByTestId('se-save-close').click()
  await expect(page.getByTestId('se-bar-draft')).toContainText('초안')
  await expect(page.getByTestId('se-bar-unsaved')).toHaveText('저장 전 3곳 바뀜') // 초안은 설비에 가지 않는다 — 저장 전 변경은 남는다

  // 새로고침: 저장 전 변경이 있어 브라우저 떠나기 확인이 뜬다. 주소의 시나리오는 현재 버전(초안이 아니다)으로 다시 열린다.
  const dialogs = []
  page.on('dialog', (d) => { dialogs.push(d.type()); d.accept() })
  await page.reload()
  expect(dialogs).toEqual(['beforeunload'])
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(SOURCE))
  await expect(cellOf(page, 's0', 'onFalse')).toHaveText('FAIL')
  await expect(page.getByTestId('se-bar-description')).toHaveValue('조건 4종')

  // 불러오기: 초안이 있는 행 → 고르기 창 → [초안 이어서 열기]
  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption(CVD.process)
  await page.getByTestId('se-load-model').selectOption(CVD.model)
  await page.getByTestId('se-load-search').fill(SOURCE.name)
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name: SOURCE.name, exact: true }).dblclick()
  const choice = page.getByTestId('se-load-choice')
  await expect(choice).toContainText('내 초안')
  await choice.getByTestId('se-load-choice-draft').click()
  await expect(page.getByTestId('se-bar-version')).toContainText('시작한 버전')
  await expect(page.getByTestId('se-bar-draft')).toContainText('초안')
  await expect(rows(page)).toHaveCount(4)
  await expect(cellOf(page, 's0', 'onFalse')).toHaveText('→3')
  await expect(page.getByTestId('se-bar-description')).toHaveValue('E2E 초안 메일 제목')
  await expect(page.getByTestId('se-bar-timeout')).toHaveValue('75')
  await expect(page.getByTestId('se-bar-unsaved')).toHaveText('저장 전 3곳 바뀜')
  await expectImagesOf(page, 's0')
})

test('② 다른 이름으로 배포 → 바의 이름·버전이 새 값, 원본은 그대로, 다시 열면 같은 스텝·참조', async ({ page }) => {
  const AS = { ...CVD, name: sewName('AS') }
  const before = await api.versions(SOURCE)
  const src = await api.open(SOURCE)
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)
  await pickNext(page, 's0', 'onFalse', 's2')
  await page.getByTestId('se-bar-timeout').fill('90')

  await openSave(page)
  await page.getByTestId('se-save-name').fill(AS.name)
  await expect(save(page)).toContainText(`원본 ${SOURCE.name} 은 그대로 남습니다`)
  const version = await deployOk(page, `${idOf(AS)} 을 새로 저장하고`)
  await expectCurrent(page, AS, version)
  await expect(page).toHaveURL(new RegExp(`n=${AS.name}&v=current`))
  expect(await api.versions(SOURCE)).toEqual(before) // 원본은 그대로(DC-025)
  expect(await api.versions(AS)).toHaveLength(1)

  await reopen(page, AS)
  await expectCurrent(page, AS, version)
  await expect(rows(page)).toHaveCount(4)
  await expect(cellOf(page, 's0', 'onFalse')).toHaveText('→3')
  await expect(page.getByTestId('se-bar-timeout')).toHaveValue('90')
  await expectImagesOf(page, 's0')
  // 저장된 판: 고친 1번 실패 시만 다르고 나머지 스텝·그림 참조는 원본과 같다
  const back = await api.open(AS)
  expect(back.edited.steps).toHaveLength(4)
  expect(noUrls(back.edited.steps.slice(1))).toEqual(noUrls(src.edited.steps.slice(1)))
  const { next: n0, ...s0 } = back.edited.steps[0]
  const { next: m0, ...t0 } = src.edited.steps[0]
  expect(noUrls(s0)).toEqual(noUrls(t0))
  expect(n0.onTrue).toEqual(m0.onTrue)
  expect(n0.onFalse).not.toEqual(m0.onFalse)
  expect(back.edited.header.timeoutLimit).toBe('90')
})

test('③ 이미 있는 이름 → 덮어쓰기 확인과 운영 속성 차이 → 체크한 뒤 배포', async ({ page }) => {
  const EX = { ...CVD, name: sewName('EX') }
  const src = await api.open(SOURCE)
  expect(src.edited.property.StartDelay).toBe(0)
  await api.deployFrom(SOURCE, EX, (s) => { s.property.StartDelay = 30 }) // 대상은 시작 지연만 다르다
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)

  await openSave(page)
  await page.getByTestId('se-save-name').fill(EX.name)
  const exists = page.getByTestId('se-save-exists')
  await expect(exists).toContainText('이미 있는 시나리오입니다')
  await expect(page.getByTestId('se-save-diff')).toHaveText(['시작 지연: 30초 → 0초'])
  await expect(page.getByTestId('se-save-deploy')).toBeDisabled()
  await expect(page.getByTestId('se-save-why')).toHaveText('이미 있는 시나리오에 덮어쓸지 확인하세요.')
  await page.getByTestId('se-save-overwrite').check()
  const version = await deployOk(page, `${idOf(EX)} 에 덮어써 저장하고`)
  await expectCurrent(page, EX, version)
  expect(await api.versions(EX)).toHaveLength(2)
  expect((await api.open(EX)).edited.property.StartDelay).toBe(0)
})

test('④ 막힘(미해결 갈 곳) → 배포 꺼짐·초안은 됨, 막힌 줄을 누르면 그 스텝', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)
  // ALL_CONDITIONS 1번의 실패 시를 3번으로 바꾸고 1번만 복사 — 3번은 묶음 밖이라 다른 시나리오에 붙이면 미해결
  await pickNext(page, 's0', 'onFalse', 's2')
  await selectRow(page, 's0')
  await page.getByTestId('se-tool-copy').click()
  await expect(toast(page)).toContainText('스텝 1개를 복사했습니다')
  await openFromDialog(page, CVD.process, CVD.model, 'NEXT_RULES', { leave: 'drop' })
  await expect(rows(page)).toHaveCount(5)
  await selectRow(page, 's4')
  await menu(page, 'se-tool-paste', '[data-paste="before"]')
  await expect(toast(page)).toContainText('갈 곳을 골라야 하는 곳이 1개 있습니다')
  await expect(rows(page)).toHaveCount(6)
  const pasted = await rowAt(page, 4).getAttribute('row-id')
  expect(pasted).not.toBe('s4')
  await expect(cellOf(page, pasted, 'onFalse')).toContainText('미해결')
  await selectRow(page, 's0')

  await openSave(page)
  const blocked = save(page).locator('[data-testid="se-save-issue"].blk')
  await expect(blocked).toHaveCount(1)
  await expect(blocked).toContainText('갈 곳이 정해지지 않았습니다')
  await expect(blocked).toContainText('5번')
  await expect(page.getByTestId('se-save-deploy')).toBeDisabled()
  await expect(page.getByTestId('se-save-why')).toHaveText('막힌 곳 1개를 고치면 배포할 수 있습니다.')
  await expect(page.getByTestId('se-save-draft')).toBeEnabled()
  await blocked.click()
  await expect(save(page)).toHaveCount(0)
  await expect(rowOf(page, pasted)).toHaveClass(/ag-row-selected/)

  // 막혀도 초안은 저장된다
  await openSave(page)
  await page.getByTestId('se-save-draft').click()
  await expect(result(page).locator('h4')).toHaveText(/초안을 저장했습니다/)
  await page.getByTestId('se-save-close').click()
  expect((await api.drafts(CVD.process, CVD.model)).map((d) => d.name)).toEqual(['NEXT_RULES'])
})

test('⑤ 결과 모름: InterfaceServer 는 저장했는데 중계가 500(slow500) → [버전 목록 확인] → 성공 화면, 한 번만 배포됨', async ({ page }) => {
  const UNK = { ...CVD, name: sewName('UNK') }
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)

  await openSave(page)
  await page.getByTestId('se-save-name').fill(UNK.name)
  const go = page.getByTestId('se-save-deploy')
  await expect(go).toBeEnabled()
  await go.click()
  await expect(page.getByTestId('se-save-confirm')).toContainText(`${idOf(UNK)} 을 새로 저장하고`)
  await proxyMode('slow500')
  try {
    await page.getByTestId('se-save-go').click()
    await expect(result(page).locator('h4')).toHaveText(/배포됐는지 알 수 없습니다/, { timeout: 60_000 })
  } finally {
    await proxyMode('pass')
  }
  await expect(result(page)).toContainText('버전 목록을 확인한 뒤 다시 배포하세요')
  await expect(page.getByTestId('se-save-redeploy')).toHaveCount(0) // 확인 전에는 다시 보내지 않는다
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('se-save-pending')))
  expect(pending).toMatchObject({ target: UNK })
  expect(await api.versions(UNK)).toHaveLength(1) // 응답만 잃었고 판은 저장됐다
  await page.getByTestId('se-save-verify').click()
  const version = await finishOk(page)
  await expectCurrent(page, UNK, version)
  expect(await page.evaluate(() => sessionStorage.getItem('se-save-pending'))).toBeNull()
  expect(await api.versions(UNK)).toHaveLength(1)
})

test('⑥ 운영 속성 [적용] 뒤 배포 → 다시 열면 그 값, 다른 탭에서 끈 뒤 배포 → 운영 속성 충돌 확인', async ({ page }) => {
  const PROP = { ...CVD, name: sewName('PROP') }
  await api.deployFrom(SOURCE, PROP)
  await asUser(page, 'sew_master')
  await page.goto(urlOf(PROP))
  await expect(rows(page)).toHaveCount(4)

  // 운영 속성 창: [수정] → 시작 지연 120 → [적용](작업본에만) → 저장 전 1곳
  await page.getByTestId('se-property').click()
  const prop = page.getByTestId('se-property-dialog')
  await prop.getByTestId('se-prop-edit').click()
  await prop.locator('[data-pfield="StartDelay"]').fill('120')
  await prop.getByTestId('se-prop-apply').click()
  await expect(toast(page)).toContainText('적용했습니다')
  await expect(prop.getByTestId('se-prop-pending')).toContainText('1')
  await prop.getByLabel('닫기').click()
  await expect(prop).toHaveCount(0)
  await expect(page.getByTestId('se-bar-unsaved')).toHaveText('저장 전 1곳 바뀜')
  await openSave(page)
  const version = await deployOk(page, `${idOf(PROP)} 의 새 버전을 저장하고`)
  await expectCurrent(page, PROP, version)

  await reopen(page, PROP)
  await page.getByTestId('se-property').click()
  await expect(prop.locator('.se-pp-delay')).toContainText('2분')
  await prop.getByLabel('닫기').click()
  expect((await api.open(PROP)).edited.property.StartDelay).toBe(120)

  // 같은 브라우저의 다른 탭에서 불러오기 창 스위치로 끈다(배포 없이 바로 바뀐다)
  const other = await page.context().newPage()
  await asUser(other, 'sew_master')
  await other.goto('/scenario-editor')
  await other.getByTestId('se-load').click()
  await other.getByTestId('se-load-process').selectOption(CVD.process)
  await other.getByTestId('se-load-model').selectOption(CVD.model)
  await other.getByTestId('se-load-search').fill(PROP.name)
  await other.getByTestId('se-load-dialog').getByRole('gridcell', { name: PROP.name, exact: true }).click()
  const sw = other.getByTestId('se-load-switch')
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await sw.click()
  await expect(other.getByTestId('se-load-switch-note')).toContainText('껐습니다')
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await other.close()
  expect((await api.open(PROP)).edited.property.IsEnabled).toBe(false)

  // 열어 둔 편집 화면(켜짐을 아는 판)에서 고쳐 배포 → 운영 속성 충돌 → 확인 체크 뒤 배포하면 이 화면의 값(켜짐)
  await page.getByTestId('se-bar-description').fill('E2E 충돌 뒤 메일 제목')
  await openSave(page)
  await expect(page.getByTestId('se-save-conflict')).toContainText('열어 둔 사이 운영 속성이 바뀌었습니다')
  await expect(page.getByTestId('se-save-deploy')).toBeDisabled()
  await expect(page.getByTestId('se-save-why')).toHaveText('운영 속성을 이 화면의 값으로 바꿀지 확인하세요.')
  await page.getByTestId('se-save-force').check()
  const v2 = await deployOk(page, `${idOf(PROP)} 의 새 버전을 저장하고`)
  await expectCurrent(page, PROP, v2)
  await expect(page.getByTestId('se-bar')).toContainText('켜짐')
  const now = await api.open(PROP)
  expect(now.edited.property.IsEnabled).toBe(true)
  expect(now.edited.property.StartDelay).toBe(120)
  expect(now.edited.header.description).toBe('E2E 충돌 뒤 메일 제목')
})

test('⑦ [이 버전으로 되돌려 열기] → 배포 → 새 판 내용 = 옛 판', async ({ page }) => {
  const RST = { ...CVD, name: sewName('RST') }
  const v1 = (await api.deployFrom(SOURCE, RST)).crtime
  await api.deployFrom(RST, RST, (s) => { s.steps[1].descriptionToEmail = 'E2E 둘째 판 설명' })
  await asUser(page, 'sew_master')
  await page.goto(urlOf(RST))
  await expect(cellOf(page, 's1', 'desc')).toHaveText('E2E 둘째 판 설명')

  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption(CVD.process)
  await page.getByTestId('se-load-model').selectOption(CVD.model)
  await page.getByTestId('se-load-search').fill(RST.name)
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name: RST.name, exact: true }).click()
  const versions = page.getByTestId('se-load-pane').getByTestId('se-load-version')
  await expect(versions).toHaveCount(2)
  await versions.filter({ hasNotText: '현재' }).click()
  const restore = page.getByTestId('se-load-restore')
  await expect(restore).toHaveText('이 버전으로 되돌려 열기')
  await restore.click()
  await expect(page.getByTestId('se-load-dialog')).toHaveCount(0)
  await expect(page.getByTestId('se-bar-restored')).toContainText('옛 버전')
  await expect(page.getByTestId('se-bar-version')).toContainText('현재 버전')
  await expect(page.getByTestId('se-bar-unsaved')).toBeVisible()
  await expect(cellOf(page, 's1', 'desc')).toHaveText('상태 IDLE 확인')

  // 저장 창 "바뀐 것" = 배포하면 현재 판에서 바뀌는 곳 — 2번 설명이 옛 판 값으로 돌아간다.
  // (이미지 스텝 1번도 "그 밖의 값" 으로 함께 잡힌다: 판마다 다른 그림 URL 을 비교하기 때문 — 보고서 걱정할 점. 여기서는 개수를 고정하지 않는다)
  await openSave(page)
  await expect(page.getByTestId('se-save-change').filter({ hasText: '2번' })).toContainText('설명 E2E 둘째 판 설명 → 상태 IDLE 확인')
  const version = await deployOk(page, `${idOf(RST)} 의 새 버전을 저장하고`)
  await expectCurrent(page, RST, version)
  await expect(page.getByTestId('se-bar-restored')).toHaveCount(0)
  const list = await api.versions(RST)
  expect(list).toHaveLength(3)
  const [old, now] = await Promise.all([api.open(RST, v1), api.open(RST)])
  expect(now.version.crtime).not.toBe(v1)
  expect(noUrls(now.edited.steps)).toEqual(noUrls(old.edited.steps))
  expect(now.edited.header).toEqual(old.edited.header)

  await reopen(page, RST)
  await expect(cellOf(page, 's1', 'desc')).toHaveText('상태 IDLE 확인')
})

test('⑧ 성과 입력(심의·효과·원개발자) → [성과 저장] → 다시 열면 같은 값, 칸이 없는 EqpPerfornmanceLoss 는 그대로', async ({ page }) => {
  const PERF = { ...CVD, name: sewName('PERF') }
  await api.deployFrom(SOURCE, PERF)
  // 화면에 칸이 없는 옛 값(사내 오타 키 그대로) — 성과 저장이 건드리지 않아야 한다
  const { db: ears } = await db()
  await ears.collection('SC_PROPERTY').updateOne({ process: PERF.process, eqpModel: PERF.model, scname: PERF.name }, { $set: { 'performance.EqpPerfornmanceLoss': 77 } })
  await asUser(page, 'sew_master')
  await page.goto(urlOf(PERF))
  await expect(rows(page)).toHaveCount(4)

  await page.getByTestId('se-property').click()
  const prop = page.getByTestId('se-property-dialog')
  await expect(prop.getByTestId('se-prop-perf-done')).toHaveText('성과 미완료')
  await prop.getByTestId('se-prop-perf-open').click()
  const perf = page.getByTestId('se-perf-dialog')
  await expect(perf.getByTestId('se-perf-done')).toHaveText('미완료')
  await perf.locator('[data-pf="grade:3"]').click()
  await perf.locator('[data-pf="comment"]').fill('E2E 심사 의견 — 다시 열어도 같은 값')
  await perf.locator('[data-pf="effon:ManWorkLoss"]').check()
  await perf.locator('[data-pf="effv:ManWorkLoss"]').fill('3600')
  await perf.locator('[data-pf="search"]').fill('sew_mastercvd')
  await perf.getByTestId('se-perf-hit').filter({ hasText: 'sew_mastercvd' }).click()
  await perf.locator('[data-pf="devp:0"]').fill('100')
  await expect(perf.getByTestId('se-perf-done')).toHaveText('완료')
  const saveBtn = perf.getByTestId('se-perf-save')
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled() // 저장한 값이 새 기준 — 바뀐 것이 없다
  await expect(perf.getByTestId('se-perf-foot')).not.toContainText('바뀜')
  await perf.getByTestId('se-perf-close').click()
  await expect(perf).toHaveCount(0)
  await expect(prop.getByTestId('se-prop-perf-done')).toHaveText('성과 완료')
  await prop.getByLabel('닫기').click()

  await reopen(page, PERF)
  await page.getByTestId('se-property').click()
  await prop.getByTestId('se-prop-perf-open').click()
  await expect(perf.locator('[data-pf="grade:3"]')).toHaveAttribute('aria-checked', 'true')
  await expect(perf.locator('[data-pf="comment"]')).toHaveValue('E2E 심사 의견 — 다시 열어도 같은 값')
  await expect(perf.locator('[data-pf="effon:ManWorkLoss"]')).toBeChecked()
  await expect(perf.locator('[data-pf="effv:ManWorkLoss"]')).toHaveValue('3600')
  await expect(perf.getByTestId('se-perf-dev')).toHaveCount(1)
  await expect(perf.getByTestId('se-perf-dev')).toContainText('sew_mastercvd')
  await expect(perf.locator('[data-pf="devp:0"]')).toHaveValue('100')
  await expect(perf.getByTestId('se-perf-done')).toHaveText('완료')
  await expect(perf.getByTestId('se-perf-save')).toBeDisabled()

  const p = (await api.open(PERF)).performance
  expect(p).toMatchObject({ grade: 3, supervisorComment: 'E2E 심사 의견 — 다시 열어도 같은 값', supervisor: 'sew_master', manWorkLoss: 3600, eqpPerformanceLoss: 77 })
  expect(p.citizenDevelopers).toEqual([{ knoxId: 'sew_mastercvd', sdwt: '', name: 'SEW MASTER;CVD', contribution: 100 }])
})

test('⑨ 새 시나리오 → 다른 시나리오에서 붙여넣기 → 첫 저장 배포 → 다시 열면 같은 스텝·그림', async ({ page }) => {
  const NEW = { ...CVD, name: sewName('NEW') }
  await asUser(page, 'sew_master')
  await page.goto(urlOf(SOURCE))
  await expect(rows(page)).toHaveCount(4)
  // 1~3번(이미지·OCR·대기)을 복사한다. 4번 설비 상태는 새 스텝으로 만들 수 없는 조건이라 뺀다(CONDITION_NOT_CREATABLE).
  await selectRow(page, 's0')
  await cellOf(page, 's2', 'no').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('se-tool-count')).toHaveText('3개 선택')
  await page.getByTestId('se-tool-copy').click()
  await expect(toast(page)).toContainText('스텝 3개를 복사했습니다')
  const conditions = (await column(page, 'condition')).slice(0, 3)
  const descs = (await column(page, 'desc')).slice(0, 3)

  await page.getByTestId('se-new').click()
  const dlg = page.getByTestId('se-new-dialog')
  await expect(dlg.getByTestId('se-new-process')).toHaveValue(CVD.process) // 열린 시나리오의 공정을 미리 고른다
  await expect(dlg.getByTestId('se-new-process')).toBeEnabled() // 바꿀 수 있다(2026-11-09)
  await dlg.getByTestId('se-new-model').selectOption(CVD.model)
  await dlg.getByTestId('se-new-type').selectOption('1')
  await dlg.getByTestId('se-new-name').fill(NEW.name)
  await dlg.getByTestId('se-new-mail').fill('E2E 새 시나리오 메일')
  await expect(dlg.getByTestId('se-new-foot')).toContainText('만들 수 있습니다')
  await dlg.getByTestId('se-new-create').click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(NEW))
  await expect(page.getByTestId('se-bar-version')).toHaveText('아직 저장한 적 없음')

  await page.getByTestId('se-empty-paste').click()
  await expect(rows(page)).toHaveCount(3)
  await expect.poll(() => column(page, 'condition')).toEqual(conditions)
  // 마지막 스텝(대기)의 성공 시 NEXT 는 갈 곳이 없다 — 성공으로 끝낸다
  const last = await rowAt(page, 2).getAttribute('row-id')
  await cellOf(page, last, 'onTrue').locator('[data-pick]').click()
  await page.getByTestId('se-picker').locator('[data-end="SUCCESS"]').click()
  await expect(cellOf(page, last, 'onTrue')).toHaveText('SUCCESS')

  await openSave(page)
  await expect(save(page)).toContainText('첫 저장')
  const version = await deployOk(page, `${idOf(NEW)} 을 새로 저장하고`)
  await expectCurrent(page, NEW, version)
  await expect(page).toHaveURL(new RegExp(`n=${NEW.name}&v=current`))

  await reopen(page, NEW)
  await expectCurrent(page, NEW, version)
  await expect(rows(page)).toHaveCount(3)
  expect(await column(page, 'condition')).toEqual(conditions)
  expect(await column(page, 'desc')).toEqual(descs)
  await expect(cellOf(page, 's2', 'onTrue')).toHaveText('SUCCESS')
  await expect(page.getByTestId('se-bar-description')).toHaveValue('E2E 새 시나리오 메일')
  await expectImagesOf(page, 's0')
  const back = await api.open(NEW)
  expect(back.edited.property).toMatchObject({ Type: 1, IsEnabled: true, ID: idOf(NEW) })
  expect(await api.versions(NEW)).toHaveLength(1)
})
