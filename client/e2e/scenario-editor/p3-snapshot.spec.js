import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rowAt } from './helpers'

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
