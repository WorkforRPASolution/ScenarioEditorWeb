import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, selectRow, toast, drag } from './helpers'

// 검색(OCR) 영역을 숫자로 넣기(2026-11-17 사내 요청) — 패널 "보는 곳" 의 X·Y·W·H 가 입력 칸이다. 친 값은 큰 화면의 영역과 함께 움직이고,
// 글자·소수점·빈 칸·1 미만·음수·기준 화면 밖은 걸린 칸을 붉히고 [적용]을 막는다.
// 시험 데이터: basic ALL_CONDITIONS(1 이미지 · 2 OCR, 기준 화면 alarm.png 1920×1200, 1번 검색 영역 560, 320, 880×520)는 읽기만 하고 아무것도 저장하지 않는다.
test('검색 영역을 키보드로 — 큰 화면이 따라오고, 글자·소수점·화면 밖은 막고, 끌어 잡으면 칸이 따라온다(OCR 도 같다)', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(rows(page)).toHaveCount(4)
  const panel = page.getByTestId('se-detail')
  const box = (k) => panel.locator(`[data-area="${k}"]`)
  const values = () => Promise.all(['x', 'y', 'w', 'h'].map((k) => box(k).inputValue()))
  const type = async (k, text) => { await box(k).fill(text); await box(k).press('Enter') }
  const bad = () => panel.locator('[data-area].se-inp-bad').evaluateAll((els) => els.map((el) => el.getAttribute('data-area')))
  const err = panel.locator('[data-err="area"]')
  const apply = page.getByTestId('se-panel-apply')
  const layer = page.getByTestId('se-capture-layer')
  const rect = () => layer.getByTestId('se-search-area').evaluate((el) => ['x', 'y', 'width', 'height'].map((a) => el.getAttribute(a)))

  // ── 1번 이미지 스텝: 저장된 영역이 칸에 보이고, 기준 화면 크기가 옆에 적힌다 ──
  await selectRow(page, 's0')
  await expect.poll(values).toEqual(['560', '320', '880', '520'])
  await expect(panel.getByTestId('se-area-screen')).toHaveText('기준 화면 1920 × 1200')
  await expect(box('x')).toHaveAttribute('aria-label', '검색 영역 X — 왼쪽 위의 가로 자리')
  await expect.poll(rect).toEqual(['560', '320', '880', '520'])

  // ── X·W 를 쳐 넣으면 큰 화면의 영역이 따라오고 적용 줄에 이전 → 지금 ──
  await type('x', '600')
  await type('w', '800')
  await expect.poll(rect).toEqual(['600', '320', '800', '520'])
  await expect(page.getByTestId('se-panel-foot')).toContainText('검색 영역')
  await expect(page.getByTestId('se-panel-foot')).toContainText('800×520')
  expect(await bad()).toEqual([])

  // ── 글자·소수점·빈 칸·0: 그 칸만 붉고 이유가 보이며 [적용]이 막힌다. 친 글자는 칸에 남는다 ──
  await type('w', '80o')
  await expect(err).toHaveText('영역의 W 값은 정수로 넣으세요(소수점·글자는 넣을 수 없습니다).')
  expect(await bad()).toEqual(['w'])
  await expect(box('w')).toHaveValue('80o')
  expect(await rect()).toEqual(['600', '320', '800', '520']) // 오타 하나로 영역이 사라지지 않는다 — 큰 화면·영역 그림은 마지막 바른 값
  await expect(panel.getByTestId('se-look-area')).toBeVisible()
  await expect(page.getByTestId('se-cap-look')).toHaveText('다시 잡기')
  await expect(page.getByTestId('se-test-run')).toBeDisabled() // 칸에 보이는 값과 다른 영역으로 시험하지 않는다
  await expect(page.getByTestId('se-test-run')).toHaveAttribute('title', '영역 칸에 잘못 넣은 값이 있습니다. 먼저 고치세요.')
  await expect(apply).toHaveAttribute('data-blocked', 'true')
  await apply.click()
  await expect(box('w')).toBeFocused() // 막히면 걸린 칸으로
  await type('w', '800.5')
  await expect(err).toHaveText('영역의 W 값은 정수로 넣으세요(소수점·글자는 넣을 수 없습니다).')
  await type('w', '')
  await expect(err).toHaveText('영역의 W 값을 넣으세요.')
  expect(await rect()).toEqual(['600', '320', '800', '520'])
  await type('w', '0')
  await expect(err).toHaveText('영역의 W 값은 1 이상이어야 합니다.')
  expect(await rect()).toEqual(['600', '320', '800', '520']) // 0 을 쳐도 영역은 남는다
  await type('w', '70000')
  await expect(err).toHaveText('영역의 W 값이 너무 큽니다(65535 이하).')
  await type('w', '８００') // 전각 숫자
  await expect(box('w')).toHaveValue('800')
  await expect(err).toHaveCount(0)
  await type('w', ' 0800 ')
  await expect(box('w')).toHaveValue('800')
  await expect(err).toHaveCount(0)
  await expect(page.getByTestId('se-test-run')).toBeEnabled()
  expect(await panel.locator('[data-area].se-inp-ch').evaluateAll((els) => els.map((el) => el.getAttribute('data-area')))).toEqual(['x', 'w']) // 바뀐 칸만

  // ── 음수·기준 화면 밖: 걸린 칸(X·W, Y·H)과 화면 크기 ──
  await type('y', '-1')
  await expect(err).toHaveText('영역의 Y 값은 0 이상이어야 합니다.')
  await type('y', '320')
  await type('x', '1200')
  await expect(err).toHaveText('영역이 기준 화면(1920 × 1200)의 오른쪽 밖으로 나갑니다. X + W 는 1920 이하여야 합니다(지금 2000).')
  expect(await bad()).toEqual(['x', 'w'])
  await type('x', '1120') // 오른쪽 끝에 꼭 맞음
  await expect(err).toHaveCount(0)
  await type('h', '881')
  await expect(err).toHaveText('영역이 기준 화면(1920 × 1200)의 아래쪽 밖으로 나갑니다. Y + H 는 1200 이하여야 합니다(지금 1201).')
  expect(await bad()).toEqual(['y', 'h'])
  await type('h', '520')
  await type('x', '600')
  await expect(err).toHaveCount(0)
  await expect(apply).not.toHaveAttribute('data-blocked', 'true')

  // ── 적용하면 작업본에 들어가고, 되돌리면 칸도 돌아온다 ──
  await apply.click()
  await expect(toast(page)).toContainText('1번 스텝에 적용했습니다')
  await expect.poll(values).toEqual(['600', '320', '800', '520'])
  await page.getByTestId('se-tool-undo').click()
  await expect.poll(values).toEqual(['560', '320', '880', '520'])

  // ── 큰 화면에서 잡는 동안에는 칸이 잠기고, 끌어 잡은 영역이 칸에 들어온다 ──
  await page.getByTestId('se-cap-look').click()
  await expect(layer).toHaveAttribute('data-stage', 'area')
  for (const k of ['x', 'y', 'w', 'h']) await expect(box(k)).toBeDisabled()
  await expect(box('x')).toHaveAttribute('title', '큰 화면에서 잡는 동안에는 숫자로 넣을 수 없습니다.')
  await drag(page, layer, [400, 300, 900, 600])
  await expect(layer).toHaveAttribute('data-stage', 'train')
  await page.getByTestId('se-cap-keep').click()
  await expect(page.getByTestId('se-cap-bar')).toHaveCount(0)
  await expect(box('x')).toBeEnabled()
  const got = (await values()).map(Number)
  for (const [i, want] of [400, 300, 900, 600].entries()) expect(Math.abs(got[i] - want)).toBeLessThanOrEqual(3) // 화면 배율만큼의 픽셀 맞춤
  expect((await rect()).map(Number)).toEqual(got)
  await page.getByTestId('se-panel-revert').click()
  await expect.poll(values).toEqual(['560', '320', '880', '520'])

  // ── 2번 OCR 스텝도 같다 ──
  await selectRow(page, 's1')
  await expect(box('h')).toHaveAttribute('aria-label', 'OCR 영역 H — 높이')
  const ocr = (await values()).map(Number)
  await type('h', String(ocr[3] + 10))
  await expect.poll(rect).toEqual([ocr[0], ocr[1], ocr[2], ocr[3] + 10].map(String))
  await type('h', '9999')
  await expect(err).toContainText('아래쪽 밖으로 나갑니다')
  await page.getByTestId('se-panel-revert').click()
  await expect.poll(values).toEqual(ocr.map(String))
})
