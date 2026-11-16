import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rowAt, rows, cellOf, selectRow, column, drag, clickAt } from './helpers'
import { cleanupMemos, memosLeft, closeDb, CVD, sewName, idOf, apiAs, cleanup, leftovers, NONE_LEFT } from './sew'
import { API_URL, ROOT } from '../env.js'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { joinParts, unzip } from '../../src/features/scenario-editor/tests/helpers/unzip.js'

const { PNG } = createRequire(join(ROOT, 'tools/package.json'))('pngjs')

// P3-B 스냅샷 화면(설계 §4.1~§4.3, §12 E2E ①). 시험 데이터: `npm run seed -- snapshots`(tools/seed/data/snapshots.js) —
// SEWT_PHOTO_A01 의 "오늘" 20줄(클릭 12 · 태그 5 · 같은 ms 의 클릭+태그 · 목록에만 있는 한 줄), 어제 3줄, SEWT_CVD_A01 오늘 2줄. 그림은 640×360.
// 날짜는 "가장 늦은 날"(시험 데이터의 오늘)로 들어가므로 자정을 넘겨 돌려도 같다.
const snapRow = (page, time) => page.getByTestId('se-snap-row').filter({ hasText: time })
const count = (page) => page.getByTestId('se-snap-count')
const info = (page) => page.getByTestId('se-snap-info')
const scaleOf = (page) => page.getByTestId('se-snap-image').evaluate((el) => Number(/scale\(([\d.e-]+)\)/.exec(el.parentElement.style.transform)[1]))

async function pickEquipment(page, q, eqpId) {
  await page.getByTestId('se-snap-eqp-input').click()
  await page.getByTestId('se-snap-eqp-input').fill(q)
  await page.locator(`[data-testid="se-snap-eqp-option"][data-eqp="${eqpId}"]`).click()
}

test('① 설비 고르기 → 하루 목록 → 그림·클릭 점 → 그림 없음 → 태그 거르기·태그 이동 → 1:1 → 날짜·달력 → 새로고침 뒤 기억', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')

  // ── 접힌 띠 → 패널. 시나리오를 열지 않아도 된다 ──
  await page.getByTestId('se-snapshot-rail').click()
  await expect(page.getByTestId('se-snap-panel')).toBeVisible()
  await expect(page.getByTestId('se-snap-state')).toHaveText('설비를 고르세요.')

  // ── 설비를 고르면 가장 늦은 날의 목록이 뜨고 마지막 줄이 골라져 큰 화면이 스냅샷 모드로 그림을 띄운다 ──
  await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
  await expect(count(page)).toHaveText('20장')
  await expect(page.getByTestId('se-snap-eqp-input')).toHaveValue('SEWT_PHOTO_A01')
  await expect(snapRow(page, '22:00:00')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('se-mode-snapshot').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await expect(info(page)).toContainText('SEWT_PHOTO_A01')
  await expect(info(page)).toContainText('20 / 20')
  await expect(info(page)).toContainText('GY')

  // ── 클릭 스냅샷: 정보 줄과, 그림 위 클릭한 자리의 점 ──
  await snapRow(page, '09:13:02').click()
  await expect(info(page)).toContainText('클릭 (412, 288)')
  await expect(info(page)).toContainText('640 × 360')
  await expect(info(page)).toContainText('6 / 20')
  await expect(info(page)).toContainText('DAY')
  const dot = page.getByTestId('se-snap-dot')
  await expect(dot).toBeVisible()
  const img = await page.getByTestId('se-snap-image').boundingBox()
  const d = await dot.boundingBox()
  expect(Math.abs(d.x + d.width / 2 - (img.x + (412 / 640) * img.width))).toBeLessThan(2)
  expect(Math.abs(d.y + d.height / 2 - (img.y + (288 / 360) * img.height))).toBeLessThan(2)
  expect(Math.abs(d.width - 12)).toBeLessThan(1.5) // 확대와 상관없이 화면에서 지름 12px
  // 점에서 고리가 퍼져 나가 눈에 띈다(사내 요청) — 고리는 점의 크기·자리를 바꾸지 않는다
  expect(await dot.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('se-snap-dot-ping')

  // ── 목록에는 있는데 그림이 없는 스냅샷: 앞 그림을 비우고 이유를 보인다. 이동은 계속 된다 ──
  await snapRow(page, '16:00:00').click()
  await expect(page.getByTestId('se-snap-error')).toContainText('이 스냅샷의 그림이 서버에 없습니다')
  await expect(page.getByTestId('se-snap-image')).toHaveCount(0)
  await expect(dot).toHaveCount(0)
  await page.getByTestId('se-snap-next').click()
  await expect(snapRow(page, '17:20:40')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('se-snap-image')).toBeVisible()

  // ── 태그 거르기: 태그 6줄(한 벌 5 + 같은 ms 의 시작). 고른 줄이 태그가 아니어서 선택이 비워진다 ──
  await page.getByTestId('se-snap-filter-tag').click()
  await expect(count(page)).toHaveText('6장')
  await expect(page.getByTestId('se-snap-row')).toHaveCount(6)
  await expect(page.getByTestId('se-snap-empty')).toBeVisible()
  await expect(page.getByTestId('se-snap-row').locator('[data-testid="se-snap-tag"]')).toHaveText(['시작', '건너뜀', '실패', '중지', '성공', '시작'])

  // ── 태그 이동: 끝에서 처음으로 돌아간다 ──
  await page.getByTestId('se-snap-tag-next').click()
  await expect(info(page)).toContainText('1 / 6')
  await expect(info(page).getByTestId('se-snap-tag')).toHaveText('시작')
  await expect(page.getByTestId('se-snap-dot')).toHaveCount(0) // 태그 스냅샷에는 점이 없다
  for (let i = 0; i < 5; i++) await page.getByTestId('se-snap-tag-next').click()
  await expect(info(page)).toContainText('6 / 6')
  await page.getByTestId('se-snap-tag-next').click()
  await expect(info(page)).toContainText('1 / 6')
  await page.getByTestId('se-snap-tag-prev').click()
  await expect(info(page)).toContainText('6 / 6')
  await page.getByTestId('se-snap-filter-all').click()
  await expect(count(page)).toHaveText('20장')
  await expect(info(page)).toContainText('16 / 20') // 같은 스냅샷이 전체 목록에서는 16번째

  // ── 1:1 · 맞춤 ──
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await page.getByTestId('se-snap-zoom-actual').click()
  expect(await scaleOf(page)).toBe(1)
  await page.getByTestId('se-snap-zoom-fit').click()
  expect(await scaleOf(page)).not.toBe(1)

  // ── 날짜: 하루 앞으로 가면 목록이 바뀌고 고른 스냅샷·그림이 비워진다 ──
  const latest = await page.getByTestId('se-snap-date').innerText()
  await expect(page.getByTestId('se-snap-date-next')).toBeDisabled()
  await page.getByTestId('se-snap-date-prev').click()
  await expect(count(page)).toHaveText('3장')
  await expect(page.getByTestId('se-snap-date')).not.toHaveText(latest)
  await expect(page.getByTestId('se-snap-empty')).toBeVisible()
  await expect(page.getByTestId('se-snap-row').locator('[aria-selected="true"]')).toHaveCount(0)

  // ── 달력: 스냅샷이 있는 날에 점, 보관 기간 밖은 꺼짐. 날을 누르면 그 날로 ──
  await page.getByTestId('se-snap-date').click()
  const cal = page.getByTestId('se-snap-calendar')
  await expect(cal).toBeVisible()
  await expect(cal.locator('[data-testid="se-snap-cal-day"][data-has="1"]').nth(1)).toBeVisible()
  expect(await cal.locator('[data-testid="se-snap-cal-day"]:disabled').count()).toBeGreaterThan(0)
  await cal.locator('[data-testid="se-snap-cal-day"][data-has="1"]:enabled').last().click()
  await expect(cal).toHaveCount(0)
  await expect(count(page)).toHaveText('20장')
  await expect(page.getByTestId('se-snap-date')).toHaveText(latest)

  // ── 새로고침: 패널·설비를 기억해 목록까지 받지만 스냅샷을 고르지는 않는다 — 큰 화면은 스텝 그림 ──
  await page.reload()
  await expect(page.getByTestId('se-snap-panel')).toBeVisible()
  await expect(page.getByTestId('se-snap-eqp-input')).toHaveValue('SEWT_PHOTO_A01')
  await expect(count(page)).toHaveText('20장')
  await expect(page.getByTestId('se-mode-step').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="se-snap-row"][aria-selected="true"]')).toHaveCount(0)
  await page.getByTestId('se-snap-collapse').click()
  await expect(page.getByTestId('se-snapshot-rail')).toBeVisible()
})

test('② 내 공정 범위의 설비만 보이고, 시나리오를 연 채 스냅샷과 스텝 그림을 오간다', async ({ page }) => {
  await asUser(page, 'sew_cvd')
  await page.goto('/scenario-editor')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(page.getByTestId('se-base-image')).toBeVisible()

  // ── 설비 목록: SEWCVD 설비만. 열린 시나리오의 모델(SEWMODELA) 설비가 먼저 온다 ──
  await page.getByTestId('se-snapshot-rail').click()
  await page.getByTestId('se-snap-eqp-input').click()
  const options = page.getByTestId('se-snap-eqp-option')
  await expect(options.first()).toBeVisible()
  const ids = await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-eqp')))
  expect(ids.length).toBeGreaterThan(0)
  expect(ids.every((id) => !id.includes('PHOTO') && !id.includes('ETCH'))).toBe(true)
  expect(ids).toContain('SEWT_CVD_A01')
  expect(ids.indexOf('SEWT_CVD_A01')).toBeLessThan(ids.indexOf('SEWT_CVD_B01'))
  await page.locator('[data-testid="se-snap-eqp-option"][data-eqp="SEWT_CVD_A01"]').click()
  await expect(count(page)).toHaveText('2장')

  // ── 고른 뒤 입력 칸을 다시 눌러 치면 목록이 다시 열린다. 아무것도 안 치고 Enter 를 눌러도 설비는 그대로다 ──
  await page.getByTestId('se-snap-eqp-input').click()
  await page.getByTestId('se-snap-eqp-input').fill('b01')
  await expect(page.locator('[data-testid="se-snap-eqp-option"][data-eqp="SEWT_CVD_B01"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)
  await expect(page.getByTestId('se-snap-eqp-input')).toHaveValue('SEWT_CVD_A01')
  await page.getByTestId('se-snap-eqp-input').click()
  await expect(options.first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(options).toHaveCount(0)
  await expect(page.getByTestId('se-snap-eqp-input')).toHaveValue('SEWT_CVD_A01')
  await expect(count(page)).toHaveText('2장')

  // ── 설비를 고르면 마지막 줄이 골라져 스냅샷 모드. 스텝 그림은 숨었을 뿐이다 ──
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await expect(info(page)).toContainText('2 / 2')
  await expect(page.getByTestId('se-viewer')).toBeHidden()
  await snapRow(page, '09:30:00').click()
  await expect(info(page)).toContainText('클릭 (111, 222)')

  // ── 스텝 표의 줄을 누르면 스텝 그림으로 돌아온다. 탭으로 스냅샷에 가면 고른 스냅샷이 남아 있다 ──
  await rowAt(page, 1).locator('[col-id="no"]').click()
  await expect(page.getByTestId('se-viewer')).toBeVisible()
  await expect(page.getByTestId('se-snap-viewer')).toBeHidden()
  await expect(page.getByTestId('se-viewer').getByTestId('se-mode-step')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('se-viewer').getByTestId('se-mode-snapshot').click()
  await expect(page.getByTestId('se-snap-viewer')).toBeVisible()
  await expect(info(page)).toContainText('클릭 (111, 222)')
  await expect(snapRow(page, '09:30:00')).toHaveAttribute('aria-selected', 'true')
})

test('③ 설비 찾기 — IP 일부로 검색하면 공정·모델 목록도 좁혀지고, 공정·모델은 글자를 쳐서 고른다', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await page.getByTestId('se-snapshot-rail').click()
  const input = page.getByTestId('se-snap-eqp-input')
  const options = page.getByTestId('se-snap-eqp-option')
  const processBox = page.getByTestId('se-snap-eqp-process')
  const modelBox = page.getByTestId('se-snap-eqp-model')
  const choices = (id) => page.getByTestId(`${id}-option`).evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))

  // ── IP 일부 → 맞는 설비만, 줄에 IP 가 보인다. 안쪽 IP 로도 찾는다 ──
  await input.click()
  await input.fill('10.99.6')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveAttribute('data-eqp', 'SEWT_PHOTO_A01')
  await expect(options.first()).toContainText('10.99.6.1')
  await input.fill('192.168.0.11')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText('10.99.11.1 / 192.168.0.11')

  // ── 검색어를 둔 채 공정 칸으로 가면 검색어는 남고, 공정·모델 목록은 맞는 설비의 것만이다 ──
  await input.fill('10.99.6')
  await processBox.click()
  await expect(options).toHaveCount(0)
  await expect(input).toHaveValue('10.99.6')
  await expect(page.getByTestId('se-snap-eqp-process-option').last()).toBeVisible()
  expect(await choices('se-snap-eqp-process')).toEqual(['', 'SEWPHOTO'])
  await modelBox.click()
  await expect(page.getByTestId('se-snap-eqp-process-option')).toHaveCount(0)
  expect(await choices('se-snap-eqp-model')).toEqual(['', 'SEWMODELA'])
  // 목록은 두 칸을 합친 폭으로, 검색 칸 아래에 열린다 — 검색 칸(남은 검색어)을 덮지 않는다
  const listBox = await page.locator('.se-snap-eqp-list').boundingBox()
  const modelBoxSize = await modelBox.boundingBox()
  const inputSize = await input.boundingBox()
  expect(listBox.width).toBeGreaterThan(modelBoxSize.width * 1.8)
  expect(listBox.y).toBeGreaterThanOrEqual(inputSize.y + inputSize.height)

  // ── 모델 목록이 열린 채 검색 칸을 누르면 그 목록이 닫히고 설비 목록이 열린다. 검색어를 버리고(Esc) 공정·모델을 글자로 찾아 고른다 ──
  await input.click()
  await expect(page.getByTestId('se-snap-eqp-model-option')).toHaveCount(0)
  await expect(options).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(input).toHaveValue('')
  await processBox.click()
  await processBox.fill('wcv')
  expect(await choices('se-snap-eqp-process')).toEqual(['SEWCVD'])
  await page.keyboard.press('Enter')
  await expect(processBox).toHaveValue('SEWCVD')
  await modelBox.click()
  expect(await choices('se-snap-eqp-model')).toEqual(['', 'SEWMODELA', 'SEWMODELB'])
  await page.keyboard.press('ArrowDown') // 전체
  await page.keyboard.press('ArrowDown') // SEWMODELA
  await page.keyboard.press('ArrowDown') // SEWMODELB
  await page.keyboard.press('Enter')
  await expect(modelBox).toHaveValue('SEWMODELB')

  // ── 고른 뒤(초점이 남은 채) 칸을 다시 눌러 치면 덧붙지 않고 바뀐다 ──
  await modelBox.click()
  await page.keyboard.type('modela')
  expect(await choices('se-snap-eqp-model')).toEqual(['SEWMODELA'])
  await page.keyboard.press('Escape')
  await expect(modelBox).toHaveValue('SEWMODELB')

  // ── 좁혀진 설비를 ↑↓·Enter 로 고른다 → 목록이 뜨고 머리 줄에 지금 설비 ──
  await input.click()
  await expect(options).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue('SEWT_CVD_B01')
  await expect(page.getByTestId('se-snap-current')).toHaveText('SEWT_CVD_B01')
  await expect(page.getByTestId('se-snap-state')).toHaveText('최근 15일 안에 스냅샷이 없습니다.')

  // ── 설비를 고른 뒤에도 칸을 눌러 치면 설비 ID 뒤에 덧붙지 않는다 ──
  await input.click()
  await page.keyboard.type('prx')
  await expect(options).toHaveCount(0) // 공정·모델(SEWCVD·SEWMODELB)에 맞는 PRX 설비는 없다
  await expect(input).toHaveValue('prx')
  await page.keyboard.press('Escape')
  await expect(input).toHaveValue('SEWT_CVD_B01')

  // ── 공정을 바꿔도 그 공정에 있는 모델은 남는다. "전체" 줄로 공정을 푼다 ──
  await processBox.click()
  await processBox.fill('photo')
  await page.keyboard.press('Enter')
  await expect(processBox).toHaveValue('SEWPHOTO')
  await expect(modelBox).toHaveValue('SEWMODELB') // SEWPHOTO 에도 있는 모델이라 남는다
  await processBox.click()
  await page.locator('[data-testid="se-snap-eqp-process-option"][data-value=""]').click()
  await expect(processBox).toHaveValue('')
  await expect(processBox).toHaveAttribute('placeholder', '공정 전체')
})

test('④ 스냅샷 유무 표시 — 공정·모델 옆 "있는 설비 수 / 전체", 설비 줄에 가장 늦은 날짜·없음', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await page.getByTestId('se-snapshot-rail').click()
  const input = page.getByTestId('se-snap-eqp-input')
  const processBox = page.getByTestId('se-snap-eqp-process')
  const modelBox = page.getByTestId('se-snap-eqp-model')
  const eqpRow = (id) => page.locator(`[data-testid="se-snap-eqp-option"][data-eqp="${id}"]`)
  const note = (id, value) => page.locator(`[data-testid="${id}-option"][data-value="${value}"]`).getByTestId(`${id}-note`)

  // ── 설비 줄: 스냅샷이 있는 설비는 가장 늦은 날(월-일), 없는 설비는 "없음" ──
  await input.click()
  await input.fill('sewt_photo_a01')
  const latest = eqpRow('SEWT_PHOTO_A01').getByTestId('se-snap-eqp-latest')
  await expect(latest).toHaveText(/^\d\d-\d\d$/)
  await expect(latest).toHaveAttribute('data-has', '1')
  const monthDay = await latest.textContent()
  await input.fill('sewt_cvd_b01')
  await expect(eqpRow('SEWT_CVD_B01').getByTestId('se-snap-eqp-latest')).toHaveText('없음')
  await expect(eqpRow('SEWT_CVD_B01').getByTestId('se-snap-eqp-latest')).toHaveAttribute('data-has', '0')

  // ── 검색어를 둔 채 공정 칸으로: 맞는 설비 안에서 센다(스냅샷이 없는 한 대) ──
  await processBox.click()
  await expect(note('se-snap-eqp-process', '')).toHaveText('0 / 1')
  await expect(note('se-snap-eqp-process', 'SEWCVD')).toHaveText('0 / 1')
  await input.click()
  await input.fill('10.99.6')
  await processBox.click()
  await expect(note('se-snap-eqp-process', 'SEWPHOTO')).toHaveText('1 / 1')
  await expect(note('se-snap-eqp-process', 'SEWPHOTO')).toHaveAttribute('title', '최근 15일 안에 스냅샷이 있는 설비 1대 / 전체 1대')

  // ── 검색어 없이: 시험 스냅샷은 SEWT_PHOTO_A01·SEWT_CVD_A01 두 대뿐이다. 수는 줄의 오른쪽 끝에 있고 목록이 가로로 넘치지 않는다 ──
  await input.click()
  await page.keyboard.press('Escape')
  await processBox.click()
  await expect(note('se-snap-eqp-process', '')).toHaveText(/^2 \/ \d+$/)
  await expect(note('se-snap-eqp-process', 'SEWCVD')).toHaveText(/^1 \/ \d+$/)
  await expect(note('se-snap-eqp-process', 'SEWPHOTO')).toHaveText(/^1 \/ \d+$/)
  await expect(note('se-snap-eqp-process', 'SEWETCH')).toHaveText(/^0 \/ \d+$/)
  const list = page.locator('.se-snap-eqp-list')
  const listBox = await list.boundingBox()
  const noteBox = await note('se-snap-eqp-process', 'SEWCVD').boundingBox()
  expect(listBox.x + listBox.width - (noteBox.x + noteBox.width)).toBeLessThan(30)
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // ── 모델은 고른 공정 안에서 센다 ──
  await processBox.fill('cvd')
  await page.keyboard.press('Enter')
  await modelBox.click()
  await expect(note('se-snap-eqp-model', '')).toHaveText(/^1 \/ \d+$/)
  await expect(note('se-snap-eqp-model', 'SEWMODELB')).toHaveText(/^0 \/ \d+$/)

  // ── 그 날짜는 설비를 골랐을 때 열리는 가장 늦은 날과 같다 ──
  await processBox.click()
  await page.locator('[data-testid="se-snap-eqp-process-option"][data-value=""]').click()
  await pickEquipment(page, 'sewt_photo_a01', 'SEWT_PHOTO_A01')
  await expect(page.getByTestId('se-snap-date')).toContainText(`-${monthDay}`)
})

// ── 메모(P3-C) ── 운영과 같은 컬렉션(로컬 EARS 의 ARS_USER_MEMO)에 시험 설비 SEWT_ 의 메모만 쓰고, 시험마다 끝나면(실패해도) 지운다.
test.describe('메모', () => {
  test.beforeEach(async () => { await cleanupMemos() })
  test.afterEach(async () => { await cleanupMemos() })
  test.afterAll(async () => {
    expect(await memosLeft()).toBe(0)
    await closeDb()
  })
  // 다른 사용자가 한 일은 서버 API 로 만든다(개발용 사용자 머리글)
  const callAs = async (user, method, path, body) => {
    const res = await fetch(`${API_URL}${path}`, { method, headers: { 'X-SE-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    expect(res.status, `${method} ${path}`).toBe(200)
    return (await res.json()).data
  }
  const memoPath = (name) => `snapshots/SEWT_PHOTO_A01/${encodeURIComponent(name)}/memo`

  test('⑤ 메모 쓰기 → 거르기 → 새로고침 뒤에도 보임 → 그 사이 남이 고침(충돌) → 고치기 → 메모 목록에서 다른 날로 가기 → 지우기', async ({ page }) => {
    await asUser(page, 'sew_master')
    await page.goto('/scenario-editor')
    await page.getByTestId('se-snapshot-rail').click()
    await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
    await expect(count(page)).toHaveText('20장')
    const memoBar = page.getByTestId('se-snap-memo')
    const dialog = page.getByTestId('se-memo-dialog')
    const input = page.getByTestId('se-memo-input')

    // ── 쓰기: 작은따옴표는 막히고, Enter 로 저장하면 그림 아래 메모 줄과 목록 줄의 ✎ 에 보인다 ──
    await snapRow(page, '09:13:02').click()
    await expect(page.getByTestId('se-snap-memo-text')).toHaveCount(0)
    await page.getByTestId('se-snap-memo-write').click()
    await expect(dialog).toContainText('메모 — SEWT_PHOTO_A01 · 09:13:02')
    await expect(input).toBeFocused()
    await input.fill("it's")
    await expect(page.getByTestId('se-memo-problem')).toHaveText("메모에 작은따옴표(')는 쓸 수 없습니다.")
    await expect(page.getByTestId('se-memo-save')).toBeDisabled()
    await input.fill('알람 창이 가려짐')
    await expect(page.getByTestId('se-memo-count')).toHaveText('9 / 128자')
    await input.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('se-snap-memo-text')).toHaveText('알람 창이 가려짐')
    await expect(page.getByTestId('se-snap-memo-author')).toContainText('—')
    await expect(snapRow(page, '09:13:02').getByTestId('se-snap-memo-mark')).toHaveAttribute('title', '알람 창이 가려짐')
    await expect(page.getByTestId('se-snap-memo-mark')).toHaveCount(1)

    // ── '메모' 거르기와 메모 이동 ──
    await page.getByTestId('se-snap-filter-memo').click()
    await expect(count(page)).toHaveText('1장')
    await expect(info(page)).toContainText('1 / 1')
    await page.getByTestId('se-snap-filter-all').click()
    await snapRow(page, '22:00:00').click()
    await page.getByTestId('se-snap-memo-next').click()
    await expect(snapRow(page, '09:13:02')).toHaveAttribute('aria-selected', 'true')

    // ── 새로고침 뒤에도 서버에서 읽어 보인다 ──
    await page.reload()
    await expect(count(page)).toHaveText('20장')
    await page.getByTestId('se-snap-filter-memo').click()
    await expect(count(page)).toHaveText('1장')
    await snapRow(page, '09:13:02').click()
    await expect(page.getByTestId('se-snap-memo-text')).toHaveText('알람 창이 가려짐')
    const fileName = await snapRow(page, '09:13:02').getAttribute('data-name')

    // ── 그 사이 다른 사람이 고쳤다: 내 저장은 덮어쓰지 않고 지금 내용을 보인다. 다시 저장하면 된다 ──
    await callAs('sew_longgrade', 'PUT', memoPath(fileName), { memo: '다른 사람이 고침', expect: '알람 창이 가려짐' }) // SEWPHOTO 공정 사용자
    await page.getByTestId('se-snap-memo-edit').click()
    await expect(input).toHaveValue('알람 창이 가려짐')
    await expect(page.getByTestId('se-memo-others')).toHaveCount(0) // 화면은 아직 내 메모로 알고 있다
    await input.fill('내가 고침')
    await page.getByTestId('se-memo-save').click()
    await expect(page.getByTestId('se-memo-conflict')).toContainText('그 사이 메모가 바뀌었습니다.')
    await expect(page.getByTestId('se-memo-conflict')).toContainText('지금 내용: 다른 사람이 고침')
    await expect(page.getByTestId('se-memo-conflict')).toContainText('(고침: sew_longgrade)') // 누가 바꿨는지
    await expect(input).toHaveValue('내가 고침')
    await expect(page.getByTestId('se-snap-memo-text')).toHaveText('다른 사람이 고침') // 뒤의 화면도 지금 값으로 바뀌었다
    await page.getByTestId('se-memo-save').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('se-snap-memo-text')).toHaveText('내가 고침')

    // ── 메모 목록: 다른 날의 메모(다른 사람이 씀)로 간다 — 설비·날짜가 바뀌고 그 줄이 골라진다 ──
    const days = await callAs('sew_master', 'GET', 'snapshots/days?eqpId=SEWT_PHOTO_A01')
    const yesterday = new Date(Date.parse(`${days.latest}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const old = (await callAs('sew_master', 'GET', `snapshots?eqpId=SEWT_PHOTO_A01&date=${yesterday}`)).items[0]
    await callAs('sew_longgrade', 'PUT', memoPath(old.fileName), { memo: '어제 메모', expect: null })
    await pickEquipment(page, 'cvd_a', 'SEWT_CVD_A01') // 다른 설비를 보다가
    await expect(page.getByTestId('se-snap-current')).toHaveText('SEWT_CVD_A01')
    await page.getByTestId('se-snap-memo-list-open').click()
    const listRows = page.getByTestId('se-memo-list-row')
    await expect(listRows).toHaveCount(2)
    await expect(page.getByTestId('se-memo-list-go')).toBeDisabled()
    // 거르기 셋(공정·모델·설비)은 한 줄에 놓인다
    const filterBoxes = await Promise.all(['process', 'model', 'eqp'].map((k) => page.getByTestId(`se-memo-list-${k}`).boundingBox()))
    expect(new Set(filterBoxes.map((b) => Math.round(b.y))).size).toBe(1)
    await page.getByTestId('se-memo-list-mine').check()
    await expect(listRows).toHaveCount(1) // 내가 처음 쓴 메모만 — 남이 고쳐도 작성자는 처음 쓴 사람이다
    await expect(listRows).toContainText('내가 고침')
    await page.getByTestId('se-memo-list-mine').uncheck()
    await listRows.filter({ hasText: '어제 메모' }).click()
    await page.getByTestId('se-memo-list-go').click()
    await expect(page.getByTestId('se-memo-list')).toHaveCount(0)
    await expect(page.getByTestId('se-snap-current')).toHaveText('SEWT_PHOTO_A01')
    await expect(page.getByTestId('se-snap-date')).toContainText(yesterday)
    await expect(count(page)).toHaveText('3장')
    await expect(page.getByTestId('se-snap-memo-text')).toHaveText('어제 메모')
    await expect(page.locator('[data-testid="se-snap-row"][aria-selected="true"]')).toHaveAttribute('data-name', old.fileName)

    // ── 지우기: 남의 메모라 누구 것인지 보이고, 지우면 메모 줄이 [메모 쓰기] 로 돌아간다 ──
    await page.getByTestId('se-snap-memo-remove').click()
    await expect(page.getByTestId('se-memo-confirm')).toContainText('어제 메모')
    await expect(page.getByTestId('se-memo-others')).toContainText('님이 쓴 메모입니다.')
    await page.getByTestId('se-memo-delete').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('se-snap-memo-write')).toBeVisible()
    await expect(page.getByTestId('se-snap-memo-mark')).toHaveCount(0)
    expect((await callAs('sew_master', 'GET', `snapshots?eqpId=SEWT_PHOTO_A01&date=${yesterday}`)).items[0].memo).toBeNull()
  })

  // 사내 요청(2026-11-16): 메모 목록에서 바로 고치고, 여러 개를 골라 지운다 — 지금 보는 설비·날짜가 아니어도 된다
  test('⑧ 메모 목록에서 고치기(남의 메모 알림) → 여러 개 골라 지우기(건수·남의 메모 수 확인) → 그 사이 바뀐 메모는 지우지 않고 지금 내용으로', async ({ page }) => {
    const days = await callAs('sew_master', 'GET', 'snapshots/days?eqpId=SEWT_PHOTO_A01')
    const yesterday = new Date(Date.parse(`${days.latest}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    const today = (await callAs('sew_master', 'GET', `snapshots?eqpId=SEWT_PHOTO_A01&date=${days.latest}`)).items
    const old = (await callAs('sew_master', 'GET', `snapshots?eqpId=SEWT_PHOTO_A01&date=${yesterday}`)).items[0]
    await callAs('sew_master', 'PUT', memoPath(today[0].fileName), { memo: '내 메모 하나', expect: null })
    await callAs('sew_master', 'PUT', memoPath(today[1].fileName), { memo: '내 메모 둘', expect: null })
    await callAs('sew_longgrade', 'PUT', memoPath(today[2].fileName), { memo: '남의 메모', expect: null })
    await callAs('sew_longgrade', 'PUT', memoPath(old.fileName), { memo: '어제 메모', expect: null })

    await asUser(page, 'sew_master')
    await page.goto('/scenario-editor')
    await page.getByTestId('se-snapshot-rail').click()
    await pickEquipment(page, 'cvd_a', 'SEWT_CVD_A01') // 다른 설비를 보는 채로
    await page.getByTestId('se-snap-memo-list-open').click()
    const listRows = page.getByTestId('se-memo-list-row')
    const picked = page.getByTestId('se-memo-list-picked')
    const edit = page.getByTestId('se-memo-list-edit')
    const remove = page.getByTestId('se-memo-list-remove')
    const notice = page.getByTestId('se-memo-list-notice')
    await expect(listRows).toHaveCount(4)
    await expect(edit).toBeDisabled()
    await expect(remove).toBeDisabled()

    // ── 고치기: 줄을 하나 고르면 켜진다. 남의 메모라 누구 것인지 보이고, 저장하면 그 줄만 바뀐다 ──
    await listRows.filter({ hasText: '남의 메모' }).click()
    await expect(picked).toHaveText('1건 고름')
    await edit.click()
    const dialog = page.getByTestId('se-memo-dialog')
    await expect(dialog).toContainText('SEWT_PHOTO_A01')
    await expect(page.getByTestId('se-memo-input')).toHaveValue('남의 메모')
    await expect(page.getByTestId('se-memo-others')).toContainText('님이 쓴 메모입니다.')
    await page.getByTestId('se-memo-input').fill('목록에서 고침')
    await page.getByTestId('se-memo-input').press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(listRows.filter({ hasText: '목록에서 고침' })).toHaveCount(1)
    await expect(listRows.filter({ hasText: '남의 메모' })).toHaveCount(0)
    const edited = (await callAs('sew_master', 'GET', `snapshots?eqpId=SEWT_PHOTO_A01&date=${days.latest}`)).items[2].memo
    expect([edited.text, edited.author, edited.editedBy]).toEqual(['목록에서 고침', 'sew_longgrade', 'sew_master'])

    // ── 여러 개 고르기: 머리 칸은 보이는 줄 모두, 체크 칸은 하나씩 빼고 더한다. 둘 이상이면 고치기·가기는 꺼진다 ──
    await page.getByTestId('se-memo-list-check-all').check()
    await expect(picked).toHaveText('4건 고름')
    await expect(remove).toHaveText('지우기 (4)')
    await expect(edit).toBeDisabled()
    await expect(page.getByTestId('se-memo-list-go')).toBeDisabled()
    await listRows.filter({ hasText: '목록에서 고침' }).getByTestId('se-memo-list-check').uncheck()
    await expect(remove).toHaveText('지우기 (3)')
    await page.screenshot({ path: `/Users/hyunkyungmin/.claude/jobs/c6912d30/tmp/shots/memo-list-picked-${page.viewportSize().width}.png` })

    // ── 지우기: 건수와 남의 메모 수를 보이고 한 번 묻는다. 취소하면 그대로, 확인하면 지우고 알린다 ──
    await remove.click()
    const confirm = page.getByTestId('se-memo-list-confirm')
    await expect(confirm).toContainText('메모 3건을 지웁니다.')
    await expect(page.getByTestId('se-memo-list-confirm-others')).toHaveText('다른 사람이 쓴 메모 1건이 들어 있습니다.')
    await page.screenshot({ path: `/Users/hyunkyungmin/.claude/jobs/c6912d30/tmp/shots/memo-list-confirm-${page.viewportSize().width}.png` })
    await page.getByTestId('se-memo-list-confirm-cancel').click()
    await expect(confirm).toHaveCount(0)
    await expect(listRows).toHaveCount(4)
    await remove.click()
    await page.getByTestId('se-memo-list-confirm-ok').click()
    await expect(notice).toHaveText('메모 3건을 지웠습니다.')
    await expect(listRows).toHaveCount(1)
    await expect(listRows).toContainText('목록에서 고침')
    await expect(page.getByTestId('se-memo-list-count')).toHaveText('1건')
    expect((await callAs('sew_master', 'GET', 'memos')).items.map((m) => m.memo.text)).toEqual(['목록에서 고침'])

    // ── 그 사이 다른 사람이 바꾼 메모는 지우지 않는다 — 지금 내용으로 바뀌어 남고, 다시 지우면 지워진다 ──
    await callAs('sew_longgrade', 'PUT', memoPath(today[2].fileName), { memo: '그 사이 바뀜', expect: '목록에서 고침' })
    await listRows.first().click()
    await remove.click()
    await page.getByTestId('se-memo-list-confirm-ok').click()
    await expect(notice).toContainText('그 사이 내용이 바뀐 1건은 지우지 않았습니다')
    await expect(listRows).toContainText('그 사이 바뀜')
    await expect(remove).toHaveText('지우기 (1)') // 고른 채로 남는다
    await remove.click()
    await page.getByTestId('se-memo-list-confirm-ok').click()
    await expect(notice).toHaveText('메모 1건을 지웠습니다.')
    await expect(page.getByTestId('se-memo-list-state')).toHaveText('최근 15일 스냅샷에 달린 메모가 없습니다.')
    expect((await callAs('sew_master', 'GET', 'memos')).items).toEqual([])
  })
})

// 사내 요청(2026-11-16): 아래 스텝 목록과 오른쪽 스텝 패널을 스냅샷 패널처럼 띠로 접어 큰 화면을 넓게 본다
test('⑨ 스텝 목록·스텝 패널 접기 — 큰 화면이 그만큼 커지고, 새로고침 뒤에도 접힌 채이며, 띠를 누르면 펴진다. 접은 채 새 스텝을 시작하면 패널이 펴진다', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(page.getByTestId('se-base-image')).toBeVisible()
  await page.getByTestId('se-snapshot-rail').click()
  await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
  await snapRow(page, '09:13:02').click()
  const viewer = page.getByTestId('se-snap-viewer')
  await expect(page.getByTestId('se-snap-dot')).toBeVisible()
  const before = await viewer.boundingBox()

  // ── 스텝 목록 접기: 머리 줄의 [▼ 접기] → 띠만 남고 큰 화면이 아래로 커진다 ──
  await page.getByTestId('se-fold-steps').click()
  await expect(page.getByTestId('se-steps-section')).toBeHidden()
  await expect(page.getByTestId('se-steps-rail')).toHaveText('▲ 스텝 목록')
  const tall = await viewer.boundingBox()
  expect(tall.height - before.height).toBeGreaterThan(180)
  expect(Math.abs(tall.width - before.width)).toBeLessThan(2)

  // ── 스텝 패널 접기: 경계선 위쪽 손잡이 → 36px 띠, 큰 화면이 오른쪽으로 커진다. 그림은 다시 맞춰져 다 보인다 ──
  await page.getByTestId('se-fold-right').click()
  await expect(page.getByTestId('se-right-section')).toBeHidden()
  await expect(page.getByTestId('se-right-rail')).toHaveText('스텝 편집')
  const wide = await viewer.boundingBox()
  expect(wide.width - tall.width).toBeGreaterThan(300)
  const rail = await page.getByTestId('se-right-rail').boundingBox()
  expect(Math.round(rail.width)).toBe(36)
  const img = await page.getByTestId('se-snap-image').boundingBox()
  expect(img.x).toBeGreaterThanOrEqual(wide.x - 1)
  expect(img.x + img.width).toBeLessThanOrEqual(wide.x + wide.width + 1)
  expect(img.y + img.height).toBeLessThanOrEqual(wide.y + wide.height + 1)
  await page.screenshot({ path: `/Users/hyunkyungmin/.claude/jobs/c6912d30/tmp/shots/fold-both-${page.viewportSize().width}.png` })

  // ── 새로고침 뒤에도 접힌 채다(se-layout) ──
  await page.reload()
  await expect(page.getByTestId('se-right-rail')).toBeVisible()
  await expect(page.getByTestId('se-steps-rail')).toBeVisible()

  // ── 접은 채 스냅샷으로 새 스텝을 시작하면 패널이 펴진다(넣기·취소가 패널에 있다). 스텝 목록은 접힌 채다 ──
  await snapRow(page, '09:13:02').click()
  await page.getByTestId('se-snap-new').click()
  await page.getByTestId('se-snap-new-image').click()
  await expect(page.getByTestId('se-right-section')).toBeVisible()
  await expect(page.getByTestId('se-right-rail')).toHaveCount(0)
  await expect(page.getByTestId('se-steps-rail')).toBeVisible()
  await page.screenshot({ path: `/Users/hyunkyungmin/.claude/jobs/c6912d30/tmp/shots/fold-steps-new-step-${page.viewportSize().width}.png` })

  // ── 띠를 누르면 펴지고, 손잡이·[접기] 가 다시 보인다 ──
  await page.getByTestId('se-steps-rail').click()
  await expect(page.getByTestId('se-steps-section')).toBeVisible()
  await expect(page.getByTestId('se-fold-steps')).toBeVisible()
  await expect(page.getByTestId('se-fold-right')).toBeVisible()
})

// P3-D 받기·이력(설계 §4.6·§4.7, §12 E2E ③). 이력은 `npm run seed -- snapshots` 가 로컬 이력 서버(HttpWebServer)에 넣은 스텝 셋(tools/seed/data/history.js).
test('⑥ 여러 줄 고르기(Ctrl·Shift) → 좌표 포함으로 ZIP 받기(못 받은 것 목록) → 한 장은 PNG → 태그 스냅샷의 이력 창', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await page.getByTestId('se-snapshot-rail').click()
  await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
  await expect(count(page)).toHaveText('20장')
  const date = /\d{4}-\d{2}-\d{2}/.exec(await page.getByTestId('se-snap-date').innerText())[0]
  const dl = page.getByTestId('se-snap-download')
  const picked = page.locator('[data-testid="se-snap-row"][aria-selected="true"]')
  const imageBytes = async (fileName) => {
    const res = await fetch(`${API_URL}snapshots/SEWT_PHOTO_A01/${encodeURIComponent(fileName)}/image`, { headers: { 'X-SE-User': 'sew_master' } })
    expect(res.status, fileName).toBe(200)
    return Buffer.from(await res.arrayBuffer())
  }
  const pixel = (png, x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]] }
  const save = async (click) => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()])
    return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) }
  }

  // ── Ctrl(⌘): 더하고 빼기 — 고른 줄 수가 패널과 [받기] 에 보인다 ──
  await expect(dl).toHaveText('받기 ▾')
  await snapRow(page, '09:13:02').click()
  await expect(page.getByTestId('se-snap-picked')).toHaveCount(0)
  await snapRow(page, '11:45:30').click({ modifiers: ['ControlOrMeta'] })
  await expect(picked).toHaveCount(2)
  await expect(page.getByTestId('se-snap-picked')).toHaveText('2장 고름')
  await expect(dl).toHaveText('받기 (2) ▾')
  await expect(info(page)).toContainText('클릭 (520, 200)') // 더한 줄이 큰 화면에 뜬다
  await snapRow(page, '09:13:02').click({ modifiers: ['ControlOrMeta'] })
  await expect(picked).toHaveCount(1)
  await expect(dl).toHaveText('받기 ▾')

  // ── Shift: 범위 — 14:00:00 부터 17:20:40 까지 다섯 줄(같은 시각의 클릭·태그 두 장, 목록에만 있는 16:00:00 포함) ──
  await snapRow(page, '14:00:00').click()
  await snapRow(page, '17:20:40').click({ modifiers: ['Shift'] })
  await expect(picked).toHaveCount(5)
  await expect(page.getByTestId('se-snap-picked')).toHaveText('5장 고름')
  await expect(dl).toHaveText('받기 (5) ▾')
  const tagName = await snapRow(page, '15:30:00').nth(1).getAttribute('data-name')

  // ── 좌표 포함으로 받기: ZIP 하나. 못 받은 한 장은 건너뛰고 창에 남는다 ──
  await dl.click()
  await expect(page.getByTestId('se-snap-download-plain')).toBeVisible()
  const zip = await save(() => page.getByTestId('se-snap-download-xy').click())
  // 좌표 포함으로 받은 것은 이름에 xy 가 든다 — 묶음은 snapshots_xy, 원을 그린 장은 _xy(그림만 받은 것과 겹치지 않게)
  expect(zip.name).toBe(`SEWT_PHOTO_A01_${date}_snapshots_xy_4.zip`)
  const entries = unzip(await joinParts([new Uint8Array(zip.bytes)]))
  expect(entries.map((e) => e.name)).toEqual([
    // 15:30:00 은 같은 ms 의 클릭 + 태그다 — 원을 그린 클릭만 _xy 라 이름이 갈린다(번호 _2 가 붙지 않는다)
    `SEWT_PHOTO_A01_${date}_14-00-00-000_xy.png`, `SEWT_PHOTO_A01_${date}_15-30-00-000_xy.png`,
    `SEWT_PHOTO_A01_${date}_15-30-00-000.png`, `SEWT_PHOTO_A01_${date}_17-20-40-600_xy.png`
  ])
  // 클릭 (80, 260) 의 원: 반지름 6 자리는 빨강이고 그림 크기는 그대로다. 받기 전 그림의 그 자리는 빨강이 아니다
  const circled = PNG.sync.read(Buffer.from(entries[0].data))
  expect([circled.width, circled.height]).toEqual([640, 360])
  for (const [x, y] of [[86, 260], [74, 260], [80, 266], [80, 254]]) expect(pixel(circled, x, y), `${x},${y}`).toEqual([255, 0, 0])
  // 태그 스냅샷에는 원을 그리지 않는다 — 서버가 준 바이트 그대로
  expect(Buffer.from(entries[2].data).equals(await imageBytes(tagName))).toBe(true)
  const dialog = page.getByTestId('se-download-dialog')
  await expect(page.getByTestId('se-download-summary')).toContainText('4장을 받아')
  await expect(page.getByTestId('se-download-failed')).toHaveCount(1)
  await expect(page.getByTestId('se-download-failed')).toContainText('16:00:00')
  await expect(page.getByTestId('se-download-failed')).toContainText('그림이 서버에 없습니다')
  await page.getByTestId('se-download-close').click()
  await expect(dialog).toHaveCount(0)

  // ── 한 장은 PNG 그대로(그림만) — 창 없이 알림만 ──
  await snapRow(page, '09:13:02').click()
  const plainName = await picked.getAttribute('data-name')
  await dl.click()
  const one = await save(() => page.getByTestId('se-snap-download-plain').click())
  expect(one.name).toBe(`SEWT_PHOTO_A01_${date}_09-13-02-004.png`)
  expect(one.bytes.equals(await imageBytes(plainName))).toBe(true)
  const before = PNG.sync.read(await imageBytes(await snapRow(page, '14:00:00').getAttribute('data-name')))
  expect(pixel(before, 86, 260)).not.toEqual([255, 0, 0])
  await expect(page.getByTestId('se-snap-notice')).toHaveText('1장을 받았습니다.')
  await expect(dialog).toHaveCount(0)

  // ── 이력: 클릭 스냅샷에서는 꺼져 있고, 태그 스냅샷에서 스텝 카드가 열린다 ──
  const history = page.getByTestId('se-snap-history')
  await expect(history).toBeDisabled()
  await expect(history).toHaveAttribute('title', '태그 스냅샷에서만 이력을 볼 수 있습니다.')
  await snapRow(page, '10:00:00').click()
  await expect(history).toBeEnabled()
  await history.click()
  const hd = page.getByTestId('se-history-dialog')
  await expect(page.getByTestId('se-history-head')).toContainText('SEWT_PHOTO_A01')
  await expect(page.getByTestId('se-history-head')).toContainText('시작')
  await expect(page.getByTestId('se-history-count')).toHaveText('스텝 3개')
  const steps = page.getByTestId('se-history-step')
  await expect(steps).toHaveCount(3)
  await expect(page.getByTestId('se-history-no')).toHaveText(['1', '2', '3'])
  // 이력 서버가 이스케이프 없이 넣은 글이 글자 그대로 보인다(태그로 풀리지 않는다)
  await expect(page.getByTestId('se-history-text')).toHaveText(['로그인 창 확인', "A<B & 'x' 버튼 누르기", '완료 화면 확인'])
  for (const id of ['se-history-ref', 'se-history-screen']) {
    await expect(page.getByTestId(id)).toHaveCount(3)
    expect(await page.getByTestId(id).evaluateAll((els) => els.every((el) => el.complete && el.naturalWidth > 0))).toBe(true)
  }
  expect(await page.getByTestId('se-history-screen').first().evaluate((el) => [el.naturalWidth, el.naturalHeight])).toEqual([320, 180])
  // 그림을 누르면 크게, Esc 는 크게 본 것만 닫는다
  await page.getByTestId('se-history-screen').nth(1).click()
  await expect(page.getByTestId('se-history-zoom')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('se-history-zoom')).toHaveCount(0)
  await expect(hd).toBeVisible()
  await page.getByTestId('se-history-close').click()
  await expect(hd).toHaveCount(0)

  // ── 이력이 남지 않은 태그(같은 시각의 태그 — 넣은 이력이 없다): 안내만, 다시 시도는 없다 ──
  await snapRow(page, '15:30:00').nth(1).click()
  await history.click()
  await expect(page.getByTestId('se-history-state')).toHaveText('이력이 없습니다. 15일이 지났거나 기록되지 않았습니다.')
  await expect(page.getByTestId('se-history-retry')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(hd).toHaveCount(0)
  // 이력 창을 닫아도 스냅샷은 그대로다
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
})

// P3-E 스냅샷에서 스텝 만들기(설계 §4.8, §12 E2E ④, 완료 조건 8). 시험 스냅샷은 읽기만 — 배포는 새 시나리오 SEW_W_<시각>_<화면>_SNAP 에만 하고
// 끝나면(실패해도) 저장 E2E 와 같은 정리로 지운다. InterfaceServer 컨테이너가 떠 있어야 한다.
test.describe('스냅샷에서 스텝 만들기', () => {
  test.beforeAll(async () => { await cleanup() })
  test.afterEach(async () => { await cleanup() })
  test.afterAll(async () => {
    try {
      expect(await leftovers()).toEqual(NONE_LEFT)
    } finally {
      await closeDb()
    }
  })

  test('⑦ 새 시나리오(스텝 0) → 스냅샷으로 이미지 스텝·같은 스냅샷으로 OCR 스텝 → 배포(그림은 한 번만 올림) → 다시 열면 기준 화면이 그 스냅샷', async ({ page }) => {
    const NEW = { ...CVD, name: sewName('SNAP') }
    const SNAP = { w: 640, h: 360 } // 시험 스냅샷 크기
    const AREA = [300, 200, 240, 140] // 검색 영역 — 클릭 자리(412, 288)의 붉은 네모를 품는다
    const TRAIN = [392, 268, 40, 40] // 찾을 그림
    const OCR = [40, 40, 200, 80]
    const snapMode = () => page.locator('[data-testid="se-mode-snapshot"]:visible')
    const newBtn = page.getByTestId('se-snap-new')
    const layer = page.getByTestId('se-capture-layer')
    const naturalOf = (testid) => page.getByTestId(testid).evaluate((el) => (el.complete ? [el.naturalWidth, el.naturalHeight] : null))
    const get = async (path) => {
      const res = await fetch(new URL(path, API_URL), { headers: { 'X-SE-User': 'sew_master' } })
      expect(res.status, path).toBe(200)
      return res
    }

    await asUser(page, 'sew_master')
    // 요청에 싣는 그림 파일(필드 이름·크기)을 적어 둔다 — 브라우저는 Blob 이 든 요청 본문을 시험에 보여 주지 않는다
    await page.addInitScript(() => {
      window.__seParts = []
      const append = FormData.prototype.append
      FormData.prototype.append = function (name, value, ...rest) {
        if (value instanceof Blob) window.__seParts.push([name, value.size])
        return append.call(this, name, value, ...rest)
      }
    })
    await page.goto('/scenario-editor')
    await page.getByTestId('se-snapshot-rail').click()
    await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
    await expect(count(page)).toHaveText('20장')
    const date = /\d{4}-\d{2}-\d{2}/.exec(await page.getByTestId('se-snap-date').innerText())[0]
    await snapRow(page, '09:13:02').click()
    await expect(info(page)).toContainText('클릭 (412, 288)')
    await expect(page.getByTestId('se-snap-image')).toBeVisible()
    // 스냅샷의 서버 바이트(다시 연 기준 화면과 견준다)
    const list = (await (await get(`snapshots?eqpId=SEWT_PHOTO_A01&date=${date}`)).json()).data.items
    const fileName = list.find((i) => i.time === '09:13:02' && i.kind === 'click').fileName
    const snapBytes = Buffer.from(await (await get(`snapshots/SEWT_PHOTO_A01/${encodeURIComponent(fileName)}/image`)).arrayBuffer())

    // ── 시나리오를 열지 않았으면 꺼져 있고 까닭을 알린다 ──
    await expect(newBtn).toBeDisabled()
    await expect(newBtn).toHaveAttribute('title', /시나리오를 열거나 새로 만들면/)

    // ── 가운데가 좁아도 [새 스텝] 이 잘리지 않는다: 여러 줄을 골라 [받기 (n)] 가 길어지고 스냅샷 패널을 넓힌 채 ──
    await snapRow(page, '00:30:10').click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('se-snap-download')).toContainText('받기 (')
    const gutter = await page.getByTestId('se-gutter-l').boundingBox()
    await page.mouse.move(gutter.x + gutter.width / 2, gutter.y + 120)
    await page.mouse.down()
    await page.mouse.move(gutter.x + gutter.width / 2 + 210, gutter.y + 120, { steps: 5 })
    await page.mouse.up()
    const fits = async () => {
      const v = await page.getByTestId('se-snap-viewer').boundingBox()
      const b = await newBtn.boundingBox()
      return b.x >= v.x && b.x + b.width <= v.x + v.width + 0.5 && b.y >= v.y && b.y + b.height <= v.y + v.height + 0.5
    }
    await expect.poll(fits).toBe(true)
    await expect(page.getByTestId('se-snap-image')).toBeVisible() // 줄이 늘어도 그림 자리는 남는다
    await page.getByTestId('se-gutter-l').dblclick() // 폭을 기본값으로
    await snapRow(page, '09:13:02').click()
    await expect(page.getByTestId('se-snap-download')).toHaveText('받기 ▾')

    // ── 스텝이 없는 새 시나리오 ──
    await page.getByTestId('se-new').click()
    const dlg = page.getByTestId('se-new-dialog')
    await dlg.getByTestId('se-new-process').selectOption(CVD.process)
    await dlg.getByTestId('se-new-model').selectOption(CVD.model)
    await dlg.getByTestId('se-new-type').selectOption('1')
    await dlg.getByTestId('se-new-name').fill(NEW.name)
    await dlg.getByTestId('se-new-mail').fill('E2E 스냅샷에서 스텝')
    await dlg.getByTestId('se-new-create').click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(NEW))
    await expect(page.getByTestId('se-table-empty')).toContainText('왼쪽 스냅샷에서 화면을 골라')
    // 고른 스냅샷은 그대로다 — 스냅샷 탭으로 가면 [새 스텝] 이 켜져 있다
    if (!(await page.getByTestId('se-snap-image').isVisible())) await snapMode().click()
    await expect(snapRow(page, '09:13:02')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('se-snap-image')).toBeVisible()
    await expect(newBtn).toBeEnabled()

    // ── 이미지 스텝: 큰 화면이 스텝 그림으로 바뀌고 그 스냅샷 위에서 잡는다 ──
    await newBtn.click()
    await page.getByTestId('se-snap-new-image').click()
    await expect(layer).toHaveAttribute('data-stage', 'area')
    await expect(page.getByTestId('se-cap-bar')).toBeVisible() // 잡는 중에는 탭 자리에 단계 띠가 뜬다
    await expect(page.getByTestId('se-snap-viewer')).toBeHidden()
    await expect.poll(() => naturalOf('se-base-image')).toEqual([SNAP.w, SNAP.h])
    await drag(page, layer, AREA, SNAP)
    await expect(layer).toHaveAttribute('data-stage', 'train')
    await drag(page, layer, TRAIN, SNAP)
    await expect(layer).toHaveAttribute('data-stage', 'click')
    await clickAt(page, layer, 412, 288, SNAP)
    await page.getByTestId('se-detail').locator('[data-field="desc"]').fill('스냅샷 이미지 스텝')
    await page.getByTestId('se-new-add').click()
    await expect(rows(page)).toHaveCount(1)

    // ── 같은 스냅샷으로 OCR 스텝 ──
    await snapMode().click()
    await expect(snapRow(page, '09:13:02')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('se-snap-image')).toBeVisible()
    await newBtn.click()
    await page.getByTestId('se-snap-new-ocr').click()
    await expect(layer).toHaveAttribute('data-stage', 'ocr')
    await expect.poll(() => naturalOf('se-base-image')).toEqual([SNAP.w, SNAP.h])
    await drag(page, layer, OCR, SNAP)
    const panel = page.getByTestId('se-detail')
    await panel.locator('[data-field="ocrOp"]').selectOption('1')
    await panel.locator('[data-field="ocrVal"]').fill('IDLE')
    await panel.locator('[data-field="desc"]').fill('스냅샷 OCR 스텝')
    await page.getByTestId('se-new-add').click()
    await expect(rows(page)).toHaveCount(2)
    expect(await column(page, 'desc')).toEqual(['스냅샷 이미지 스텝', '스냅샷 OCR 스텝'])
    // 마지막 스텝의 성공 시 NEXT 는 갈 곳이 없다 — 성공으로 끝낸다
    const last = await rowAt(page, 1).getAttribute('row-id')
    await cellOf(page, last, 'onTrue').locator('[data-pick]').click()
    await page.getByTestId('se-picker').locator('[data-end="SUCCESS"]').click()
    await expect(cellOf(page, last, 'onTrue')).toHaveText('SUCCESS')

    // ── 배포: 올리는 그림은 둘 — 두 스텝이 함께 쓰는 기준 화면 하나와 찾을 그림 하나 ──
    await page.getByTestId('se-save').click()
    await expect(page.getByTestId('se-save-dialog')).toContainText('첫 저장')
    const go = page.getByTestId('se-save-deploy')
    await expect(go).toBeEnabled()
    await go.click()
    await page.evaluate(() => { window.__seParts = [] }) // 검사 요청은 그림을 싣지 않지만, 배포 요청의 것만 세게 비운다
    await page.getByTestId('se-save-go').click()
    await expect(page.getByTestId('se-save-result').locator('h4')).toHaveText(/설비에 배포했습니다/, { timeout: 60_000 })
    const parts = await page.evaluate(() => window.__seParts)
    expect(parts.map(([name]) => name.slice(0, 4))).toEqual(['img:', 'img:'])
    expect(parts.filter(([, size]) => size === snapBytes.length)).toHaveLength(1) // 기준 화면은 스냅샷 크기 그대로 한 번만
    await page.getByTestId('se-save-close').click()
    await expect(page.getByTestId('se-bar-version')).toContainText('현재 버전')

    // ── 다시 열면 두 스텝의 기준 화면이 그 스냅샷이다 ──
    await page.reload()
    await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(NEW))
    await expect(rows(page)).toHaveCount(2)
    await selectRow(page, 's0')
    await expect.poll(() => naturalOf('se-base-image')).toEqual([SNAP.w, SNAP.h])
    // 찾을 그림은 그 스냅샷에서 자른 것(끈 자리는 화면 배율만큼 1~2px 어긋날 수 있다)
    const near = (v, want) => Math.abs(v - want) <= 2
    await expect.poll(() => page.getByTestId('se-detail').locator('[data-station="find"] img').first().evaluate((el) => (el.complete ? el.naturalWidth : 0)).then((w) => near(w, TRAIN[2]))).toBe(true)
    const api = await apiAs('sew_master')
    try {
      const back = await api.open(NEW)
      expect(back.steps.map((s) => s.condition.kind)).toEqual(['image', 'ocr'])
      const area = back.steps[0].condition.searchArea
      expect([area.x, area.y, area.w, area.h].every((v, i) => near(v, AREA[i])), JSON.stringify(area)).toBe(true)
      for (const st of back.steps) {
        expect(st.baseImage.state).toBe('present')
        const bytes = Buffer.from(await (await get(st.baseImage.url.replace(/^\/scenario-editor\//, ''))).arrayBuffer())
        expect(bytes.equals(snapBytes), `스텝 ${st.no} 기준 화면`).toBe(true)
      }
      expect(await api.versions(NEW)).toHaveLength(1)
    } finally {
      await api.dispose()
    }
  })
})
