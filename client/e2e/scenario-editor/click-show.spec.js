import { test, expect } from '@playwright/test'
import { asUser, selectRow } from './helpers'

// [누를 곳 보기](2026-11-17 사내 요청 — 데스크톱 편집기의 클릭 위치 보기): 이미지 스텝의 마우스 클릭에서 "하는 일" 의 작은 버튼을 누르면
// 큰 화면의 스텝 그림에서 누를 곳(기준 화면에서 찾은 자리 + 누를 곳)에 스냅샷 클릭 점과 같은 점이 5초 동안 깜빡인다.
// 시험 데이터: basic ALL_ACTIONS(1번 왼쪽 클릭 24,12 · 찾을 그림 = Reset 단추, 기준 화면에서 711,660 에 한 곳)는 읽기만 하고 아무것도 저장하지 않는다.
const RESET = [711, 660]
const open = async (page, user) => {
  await asUser(page, user)
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=ALL_ACTIONS&v=current')
  await expect(page.getByTestId('se-bar-id')).toContainText('ALL_ACTIONS')
  await selectRow(page, 's0')
}

test('누를 곳 보기 — 작은 버튼을 누르면 스텝 그림의 누를 곳에 점이 5초 동안 깜빡인다(편집·읽기 전용), 점은 빨강·고리는 청록', async ({ page }) => {
  await open(page, 'sew_master')
  const panel = page.getByTestId('se-detail')
  const viewer = page.getByTestId('se-viewer')
  const btn = panel.getByTestId('se-click-show')
  const flash = viewer.getByTestId('se-click-flash')
  await expect(panel).toHaveAttribute('data-panel', 'edit')
  await expect(viewer.getByTestId('se-spot-click')).toHaveAttribute('data-x', String(RESET[0] + 24)) // 기준 화면에서 찾을 그림을 찾았다

  // ── 버튼은 누를 곳 X·Y 와 [다시 찍기] 사이에 있고, 누르기 전에는 점이 없다 ──
  await expect(btn).toBeEnabled()
  await expect(btn).toHaveAttribute('title', '스텝 그림에서 누를 곳을 5초 동안 깜빡여 보입니다')
  await expect(btn).toHaveAttribute('aria-label', '누를 곳 보기')
  const [b, y, r] = await Promise.all([btn.boundingBox(), panel.getByTestId('se-click-y').boundingBox(), panel.getByTestId('se-repick').boundingBox()])
  expect(b.x).toBeGreaterThanOrEqual(y.x + y.width)
  expect(b.x + b.width).toBeLessThanOrEqual(r.x + 1)
  expect(Math.abs(b.y + b.height / 2 - (r.y + r.height / 2))).toBeLessThan(3) // 한 줄에
  await expect(flash).toHaveCount(0)

  // ── 누르면: 찾은 자리 + 누를 곳에, 화면에서 지름 12px 의 점이 깜빡이고 고리가 퍼진다 ──
  await btn.click()
  await expect(flash).toBeVisible()
  await expect(flash).toHaveAttribute('data-x', String(RESET[0] + 24))
  await expect(flash).toHaveAttribute('data-y', String(RESET[1] + 12))
  const img = await viewer.getByTestId('se-base-image').boundingBox()
  const d = await flash.boundingBox()
  expect(Math.abs(d.x + d.width / 2 - (img.x + ((RESET[0] + 24) / 1920) * img.width))).toBeLessThan(2)
  expect(Math.abs(d.y + d.height / 2 - (img.y + ((RESET[1] + 12) / 1200) * img.height))).toBeLessThan(2)
  expect(Math.abs(d.width - 12)).toBeLessThan(1.5)
  const look = await flash.evaluate((el) => {
    const s = getComputedStyle(el)
    const a = getComputedStyle(el, '::after')
    return { fill: s.backgroundColor, edge: s.borderTopColor, shadow: s.boxShadow, ring: a.backgroundImage, motion: [s.animationName, a.animationName] }
  })
  expect(look.fill).toBe('rgb(220, 38, 38)') // 점 = 빨강
  expect(look.edge).toBe('rgb(255, 255, 255)') // 흰 테
  expect(look.shadow).toContain('rgba(15, 23, 42, 0.9)') // 어두운 가는 테
  expect(look.ring).toContain('radial-gradient')
  expect(look.ring).toContain('rgb(34, 211, 238)') // 고리 = 청록 — 붉은 화면에서도 보인다
  expect(look.ring).toContain('rgba(0, 0, 0, 0)') // 가운데가 빈 고리(점을 덮지 않는다)
  expect(look.motion).toEqual(['se-snap-dot-blink', 'se-snap-dot-ping'])
  await expect(viewer.getByTestId('se-spot')).toBeVisible() // 평소의 + 표시는 그대로

  // ── 5초 뒤에 저절로 사라진다 ──
  await expect(flash).toHaveCount(0, { timeout: 8000 })

  // ── 확대해 누를 곳이 화면 밖이면 전체로 맞춰 보인다 ──
  const vb = await viewer.getByTestId('se-base-image').boundingBox()
  await page.mouse.move(vb.x + vb.width * 0.9, vb.y + vb.height * 0.15)
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300)
  await expect.poll(async () => (await viewer.getByTestId('se-base-image').boundingBox()).width).toBeGreaterThan(vb.width * 2)
  await btn.click()
  await expect(flash).toBeVisible()
  await expect.poll(async () => Math.round((await viewer.getByTestId('se-base-image').boundingBox()).width)).toBe(Math.round(vb.width))

  // ── 누를 곳을 고치면 깜빡이는 점이 따라간다 ──
  await panel.locator('[data-field="click"]').fill('100')
  await panel.locator('[data-field="click"]').press('Enter')
  await expect(flash).toHaveAttribute('data-x', String(RESET[0] + 100))

  // ── 큰 화면에서 잡는 동안에는 꺼지고(까닭), 점도 사라진다 ──
  await panel.getByTestId('se-repick').click()
  await expect(page.getByTestId('se-cap-bar')).toBeVisible()
  await expect(btn).toBeDisabled()
  await expect(btn).toHaveAttribute('title', '큰 화면에서 잡는 동안에는 볼 수 없습니다.')
  await expect(flash).toHaveCount(0)
  await page.getByTestId('se-cap-cancel').click()
  await expect(btn).toBeEnabled()

  // ── 큰 화면이 스냅샷 모드여도 누르면 스텝 그림으로 돌아와 깜빡인다 ──
  await viewer.getByTestId('se-mode-snapshot').click()
  await expect(page.getByTestId('se-snap-viewer')).toBeVisible()
  await btn.click()
  await expect(viewer.getByTestId('se-mode-step')).toHaveAttribute('aria-pressed', 'true')
  await expect(flash).toBeVisible()

  // ── 다른 스텝으로 가면 사라진다. 마우스 클릭이 아닌 스텝(키보드)에는 버튼이 없다 ──
  await panel.getByTestId('se-panel-revert').click()
  await selectRow(page, 's4')
  await expect(flash).toHaveCount(0)
  await expect(panel.getByTestId('se-click-show')).toHaveCount(0)

  // ── 읽기 전용(WRITE 없음 sew_cvd): 상세의 "동작" 옆 같은 버튼 ──
  await open(page, 'sew_cvd')
  const detail = page.getByTestId('se-detail')
  await expect(detail).not.toHaveAttribute('data-panel', 'edit')
  await expect(viewer.getByTestId('se-spot-click')).toHaveAttribute('data-x', String(RESET[0] + 24))
  await detail.getByTestId('se-click-show').click()
  await expect(flash).toBeVisible()
  await expect(flash).toHaveAttribute('data-x', String(RESET[0] + 24))
  await expect(flash).toHaveAttribute('data-y', String(RESET[1] + 12))
})
