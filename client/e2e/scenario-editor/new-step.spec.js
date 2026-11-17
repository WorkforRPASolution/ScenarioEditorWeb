import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, selectRow, column, toast, drag } from './helpers'

// 새 스텝 메뉴(2026-11-17 사내 요청) — 표 위 [새 스텝] 과 스냅샷 화면 [새 스텝] 이 같은 메뉴를 연다: 화면마다 한 줄(지금 스냅샷·고른 스텝의 화면·그림 파일)
// + 종류 버튼([이미지]·[OCR]), 맨 아래 조건 없는 스텝. 넣을 자리는 어디서 만들든 고른 줄 뒤.
// 시험 데이터: basic ALL_CONDITIONS(1 이미지 · 2 OCR · 3 대기 · 4 설비 상태, 기준 화면 alarm.png 1920×1200)는 읽기만 하고 아무것도 저장하지 않는다.
// 스냅샷 SEWT_PHOTO_A01(640×360, `npm run seed -- snapshots`).
const snapRow = (page, time) => page.getByTestId('se-snap-row').filter({ hasText: time })
async function pickEquipment(page, q, eqpId) {
  await page.getByTestId('se-snap-eqp-input').click()
  await page.getByTestId('se-snap-eqp-input').fill(q)
  await page.locator(`[data-testid="se-snap-eqp-option"][data-eqp="${eqpId}"]`).click()
}

test('표 위 [새 스텝] — 스냅샷을 골랐을 때만 스냅샷 줄이 켜지고 그 스냅샷이 기준 화면이 된다 → 그림 파일(JPG → PNG) → 넣을 자리는 고른 줄 뒤 → 스냅샷 화면의 메뉴도 같다', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(rows(page)).toHaveCount(4)
  const tool = page.getByTestId('se-tool-menu')
  const src = (box, name) => box.locator(`[data-src="${name}"]`)
  const item = (id) => page.getByTestId(`se-new-${id}`)
  const layer = page.getByTestId('se-capture-layer')
  const where = page.getByTestId('se-new-where')
  const panel = page.getByTestId('se-detail')
  const naturalOf = (locator) => locator.evaluate((el) => (el.complete ? [el.naturalWidth, el.naturalHeight] : null))
  const baseSize = () => naturalOf(page.getByTestId('se-base-image'))
  const inViewport = async (locator) => {
    const b = await locator.boundingBox()
    const vp = page.viewportSize()
    return b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height
  }

  // ── 스냅샷을 고르지 않았다: 스냅샷 줄은 꺼지고 까닭이 그 줄에, 고른 1번 스텝의 화면과 그림 파일은 켜져 있다 ──
  await selectRow(page, 's0')
  await page.getByTestId('se-tool-new').click()
  await expect(tool.locator('[data-src]')).toHaveCount(3)
  await expect(src(tool, 'snapshot')).toContainText('왼쪽 목록에서 스냅샷을 고르면 켜집니다')
  await expect(item('snapshot-image')).toBeDisabled()
  await expect(item('snapshot-ocr')).toBeDisabled()
  await expect(src(tool, 'step')).toContainText('1번 스텝의 화면')
  await expect.poll(() => naturalOf(src(tool, 'step').locator('img'))).toEqual([1920, 1200]) // 어느 화면인지 작은 그림으로
  await expect(item('step-image')).toBeEnabled()
  await expect(item('file-image')).toBeEnabled()
  await expect(item('none')).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(tool).toHaveCount(0)

  // ── 기준 화면이 없는 스텝(3번 대기)을 고르면 스텝 줄도 꺼진다 — 전에는 말없이 1번 스텝의 화면을 썼다 ──
  await selectRow(page, 's2')
  await page.getByTestId('se-tool-new').click()
  await expect(src(tool, 'step')).toContainText('3번 스텝의 화면')
  await expect(src(tool, 'step')).toContainText('이 스텝에는 기준 화면이 없습니다')
  await expect(item('step-image')).toBeDisabled()
  await expect(item('step-ocr')).toBeDisabled()
  await page.keyboard.press('Escape')

  // ── 왼쪽에서 스냅샷을 고르고 스텝 표로 돌아온다(큰 화면은 스텝 그림) → 표 위 메뉴의 스냅샷 줄이 켜지고 어느 스냅샷인지 보인다 ──
  await page.getByTestId('se-snapshot-rail').click()
  await pickEquipment(page, 'photo_a', 'SEWT_PHOTO_A01')
  await snapRow(page, '09:13:02').click()
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await selectRow(page, 's2')
  await expect(page.getByTestId('se-snap-viewer')).toBeHidden()
  await page.getByTestId('se-tool-new').click()
  await expect(src(tool, 'snapshot')).toContainText('09:13:02')
  await expect(src(tool, 'snapshot')).toContainText('클릭 (412, 288)')
  await expect.poll(() => naturalOf(src(tool, 'snapshot').locator('img'))).toEqual([640, 360])
  expect(await inViewport(tool)).toBe(true)
  await item('snapshot-image').click()
  await expect(tool).toHaveCount(0)
  // 기준 화면은 고른 스냅샷(640×360)이다 — 다른 스텝의 화면(1920×1200)이 아니다
  await expect(layer).toHaveAttribute('data-stage', 'area')
  await expect.poll(baseSize).toEqual([640, 360])
  // 넣을 자리: 고른 3번의 뒤 = 4번 앞
  await expect(where).toHaveValue('s3')
  await expect(where.locator('option:checked')).toContainText('4번 앞')
  await page.getByTestId('se-new-cancel').click()
  await expect(where).toHaveCount(0)

  // ── 그림 파일: JPG 를 고르면 PNG 로 바뀌어 기준 화면이 되고, 다른 스텝의 기준 화면과 크기가 다르다고 알린다(막지는 않는다) ──
  const jpg = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 800; c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#1f3352'; g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#ffffff'; g.font = '48px sans-serif'; g.fillText('READY', 100, 200)
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]
  }), 'base64')
  expect([...jpg.subarray(0, 2)]).toEqual([0xff, 0xd8])
  await selectRow(page, 's1')
  await page.getByTestId('se-tool-new').click()
  await expect(src(tool, 'file')).toContainText('설비 화면 전체를 제 크기로 찍은 그림')
  const chooser = page.waitForEvent('filechooser')
  await item('file-ocr').click()
  await expect(tool).toHaveCount(0) // 메뉴는 바로 닫힌다
  await (await chooser).setFiles({ name: 'screen.jpg', mimeType: 'image/jpeg', buffer: jpg })
  await expect(layer).toHaveAttribute('data-stage', 'ocr')
  await expect.poll(baseSize).toEqual([800, 600])
  await expect(toast(page)).toContainText('고른 그림(800 × 600)이 2번 스텝의 기준 화면(1920 × 1200)과 크기가 다릅니다')
  // 올릴 그림은 PNG 다(서버는 PNG 만 받는다)
  const head = await page.getByTestId('se-base-image').evaluate(async (el) => [...new Uint8Array(await (await fetch(el.src)).arrayBuffer()).subarray(0, 4)])
  expect(head).toEqual([0x89, 0x50, 0x4e, 0x47])
  await drag(page, layer, [80, 140, 300, 90], { w: 800, h: 600 })
  await panel.locator('[data-field="ocrOp"]').selectOption('1')
  await panel.locator('[data-field="ocrVal"]').fill('READY')
  await panel.locator('[data-field="desc"]').fill('그림 파일 OCR 스텝')
  await expect(where).toHaveValue('s2') // 고른 2번의 뒤 = 3번 앞
  await page.getByTestId('se-new-add').click()
  await expect(rows(page)).toHaveCount(5)
  expect((await column(page, 'desc'))[2]).toBe('그림 파일 OCR 스텝')

  // ── 그림이 아닌 파일은 알리고 만들지 않는다 ──
  await page.getByTestId('se-tool-new').click()
  // 방금 넣은 3번 스텝이 골라져 있다 — 그 화면(올린 그림)을 빌릴 수 있다
  await expect(src(tool, 'step')).toContainText('3번 스텝의 화면')
  await expect.poll(() => naturalOf(src(tool, 'step').locator('img'))).toEqual([800, 600])
  const chooser2 = page.waitForEvent('filechooser')
  await item('file-image').click()
  await (await chooser2).setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(toast(page)).toContainText('그림으로 읽을 수 없는 파일입니다')
  await expect(where).toHaveCount(0)

  // ── 스냅샷 화면의 [새 스텝] 도 같은 메뉴다 — 조건 없는 스텝은 방금 고른 줄(3번)의 뒤에 들어간다 ──
  await page.locator('[data-testid="se-mode-snapshot"]:visible').click()
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await page.getByTestId('se-snap-new').click()
  const pop = page.getByTestId('se-snap-new-menu')
  await expect(pop.locator('[data-src]')).toHaveCount(3)
  await expect(src(pop, 'snapshot')).toContainText('09:13:02')
  await expect(src(pop, 'step')).toContainText('3번 스텝의 화면')
  await expect(item('step-ocr')).toBeEnabled()
  expect(await inViewport(pop)).toBe(true)
  await item('none').click()
  await expect(pop).toHaveCount(0)
  await expect(page.getByTestId('se-panel-kind')).toHaveText('조건 없음')
  await expect(where).toHaveValue('s2') // 옛 3번(대기) 앞 = 새 3번의 뒤
  await expect(where.locator('option:checked')).toContainText('4번 앞')
})
