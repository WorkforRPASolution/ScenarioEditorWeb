import { test, expect } from '@playwright/test'
import { asUser, openFromDialog } from './helpers'

// P2-C 편집 명령(설계 §2 완료 조건 2 의 편집 부분). 저장 → 다시 열기는 저장 창이 있는 P2-D E2E 가 맡는다.
// 시험 데이터: basic NEXT_RULES(1 이미지 · 2 →4/SKIP · 3 도달 불가 · 4 OCR NEXT/→2 · 5 끝), ALL_CONDITIONS(1 이미지 · 2 OCR · 3 대기 · 4 설비 상태).
// 서버 uid 는 s0…(위치), 브라우저가 만든 스텝은 n…·p…. 기준 화면은 alarm.png(1920×1200), 1번 스텝 찾을 그림은 그 Reset 단추를 자른 것.
const IMG = { w: 1920, h: 1200 }
const DIALOG = [560, 320, 880, 520] // 검색 영역(tools/scenario-gen/scenarios/basic.js)
const RESET = [711, 660, 255, 96] // 찾을 그림

const table = '[data-testid="se-step-table"] .ag-center-cols-container'
const rows = (page) => page.locator(`${table} .ag-row`)
const rowAt = (page, i) => page.locator(`${table} .ag-row[row-index="${i}"]`)
const rowOf = (page, uid) => page.locator(`${table} .ag-row[row-id="${uid}"]`)
const cellOf = (page, uid, col) => rowOf(page, uid).locator(`[col-id="${col}"]`)
const toast = (page) => page.getByTestId('se-toast')
// 표 순서(uid). AG Grid 행 DOM 순서는 보장되지 않아 row-index 로 정렬한다.
const order = (page) => rows(page).evaluateAll((els) => els.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index'))).map((r) => r.getAttribute('row-id')))

// 한 줄 고르기. AG Grid 는 cellClicked 를 0ms 타이머로 넘기므로 고른 표시가 뜰 때까지 기다린다(단축키·도구 줄 전에).
async function selectRow(page, uid) {
  await cellOf(page, uid, 'no').click()
  await expect(rowOf(page, uid)).toHaveClass(/ag-row-selected/)
}
async function menu(page, opener, item) {
  await page.getByTestId(opener).click()
  await page.getByTestId('se-tool-menu').locator(item).click()
}
// 큰 화면 잡기 층 위의 기준 화면 픽셀 → 화면 좌표(층은 확대·이동이 들어간 상자 안에 있다)
async function toScreen(layer, x, y) {
  const b = await layer.boundingBox()
  return { x: b.x + (x * b.width) / IMG.w, y: b.y + (y * b.height) / IMG.h }
}
async function drag(page, layer, [x, y, w, h]) {
  const a = await toScreen(layer, x, y)
  const z = await toScreen(layer, x + w, y + h)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(z.x, z.y, { steps: 6 })
  await page.mouse.up()
}
async function clickAt(page, layer, x, y) {
  const p = await toScreen(layer, x, y)
  await page.mouse.click(p.x, p.y)
}

test('① 잡아 넣기·삭제 막힘·다른 시나리오 붙여넣기·잘라 옮기기·다시 찍기·확인 창·되돌리기 → 검사 막힘 없음', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor')

  // ── 다른 시나리오에서 복사: ALL_CONDITIONS 1번(이미지)의 실패 시를 3번으로 바꾸고 1번만 복사 — 3번은 묶음 밖이다 ──
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(rows(page)).toHaveCount(4)
  await cellOf(page, 's0', 'onFalse').locator('[data-pick]').click()
  await page.getByTestId('se-picker').locator('[data-to="s2"]').click()
  await expect(cellOf(page, 's0', 'onFalse')).toHaveText('→3')
  await selectRow(page, 's0')
  await page.getByTestId('se-tool-copy').click()
  await expect(toast(page)).toContainText('스텝 1개를 복사했습니다')

  // ── NEXT_RULES 를 연다(복사해 둔 묶음은 남는다) ──
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'NEXT_RULES')
  await expect(rows(page)).toHaveCount(5)
  await expect(page.getByTestId('se-tool-paste')).toContainText('1개')
  await expect(cellOf(page, 's1', 'onTrue')).toHaveText('→4')

  // ── 새 이미지 스텝: 기준 화면에서 검색 영역 → 찾을 그림 → 누를 곳을 끌어 잡고 3번 앞에 넣는다 ──
  await selectRow(page, 's2')
  await menu(page, 'se-tool-new', '[data-new="image"]')
  const layer = page.getByTestId('se-capture-layer')
  await expect(layer).toHaveAttribute('data-stage', 'area')
  await drag(page, layer, DIALOG)
  await expect(layer).toHaveAttribute('data-stage', 'train')
  // 찾을 그림: 기준 화면을 fetch → createImageBitmap 으로 받아 canvas 로 잘라 PNG(올릴 그림)
  await drag(page, layer, RESET)
  await expect(layer).toHaveAttribute('data-stage', 'click')
  await clickAt(page, layer, RESET[0] + 24, RESET[1] + 12)
  await expect(page.getByTestId('se-cap-bar')).toHaveCount(0)
  const panel = page.getByTestId('se-detail')
  await expect(panel.locator('[data-station="find"] img')).toHaveCount(1) // 잘라 낸 찾을 그림(blob URL)이 패널에 보인다
  await panel.locator('[data-field="desc"]').fill('새 이미지 스텝')
  await expect(page.getByTestId('se-new-before')).toHaveText('3번 앞에 넣기')
  await page.getByTestId('se-new-before').click()
  await expect(rows(page)).toHaveCount(6)
  const added = await rowAt(page, 2).getAttribute('row-id')
  expect(['s0', 's1', 's2', 's3', 's4']).not.toContain(added)
  await expect(cellOf(page, added, 'condition')).toHaveText('이미지')
  await expect(toast(page)).toContainText('다른 스텝의 번호 1곳이 새 번호를 따라갔습니다')
  // 뒤 번호가 따라간다: 2번 성공 시 →4 가 →5(옛 4번이 5번), 5번의 실패 시 →2 는 그대로
  await expect(cellOf(page, 's1', 'onTrue')).toHaveText('→5')
  await expect(rowOf(page, 's3')).toHaveAttribute('row-index', '4')
  await expect(cellOf(page, 's3', 'onFalse')).toHaveText('→2')

  // ── 가리키는 스텝 지우기는 막히고, 목록에서 가리키는 스텝으로 간다 ──
  await selectRow(page, 's3')
  await page.getByTestId('se-tool-delete').click()
  const block = page.getByTestId('se-delblock')
  await expect(block).toContainText('5번 스텝을 지울 수 없습니다')
  await block.locator('[data-ref="s1"]').click()
  await expect(block).toHaveCount(0)
  await expect(rowOf(page, 's1')).toHaveClass(/ag-row-selected/)
  await expect(panel).toContainText('2 → 4, 실패 SKIP')
  await expect(rows(page)).toHaveCount(6)

  // ── 다른 시나리오에서 복사한 스텝을 마지막 스텝 앞에 붙인다 → 묶음 밖 갈 곳은 미해결 ──
  await selectRow(page, 's4')
  await menu(page, 'se-tool-paste', '[data-paste="before"]')
  await expect(toast(page)).toContainText('갈 곳을 골라야 하는 곳이 1개 있습니다')
  await expect(rows(page)).toHaveCount(7)
  const pasted = await rowAt(page, 5).getAttribute('row-id')
  await expect(rowOf(page, pasted)).toHaveClass(/ag-row-selected/) // 첫 미해결 스텝을 고른다
  const open = cellOf(page, pasted, 'onFalse').locator('.se-pill-unresolved')
  await expect(open).toHaveText('미해결 3')
  await expect(page.getByTestId('se-base-image')).toBeVisible() // 그림은 ALL_CONDITIONS 판의 것(다른 판 참조)
  await open.click()
  await page.getByTestId('se-picker').locator('[data-end="FAIL"]').click()
  await expect(cellOf(page, pasted, 'onFalse')).toHaveText('FAIL')

  // ── 두 줄(1·2번)을 잘라 새 스텝(3번) 뒤에 붙인다 ──
  await selectRow(page, 's0')
  await cellOf(page, 's1', 'no').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('se-tool-count')).toHaveText('2개 선택')
  await page.getByTestId('se-tool-cut').click()
  await expect(rowOf(page, 's0')).toHaveClass(/se-row-cut/)
  await selectRow(page, added)
  await menu(page, 'se-tool-paste', '[data-paste="after"]')
  await expect(toast(page)).toContainText('스텝 2개를 옮겼습니다')
  await expect.poll(() => order(page)).toEqual([added, 's0', 's1', 's2', 's3', pasted, 's4'])
  await expect(cellOf(page, 's1', 'onTrue')).toHaveText('→5')
  await expect(cellOf(page, 's3', 'onFalse')).toHaveText('→3')

  // ── [다시 찍기]: 기준 화면의 검색 영역에서 찾을 그림을 한 곳 찾아 누를 곳만 찍는다 ──
  await selectRow(page, 's0')
  await expect(page.getByTestId('se-repick')).toHaveText('다시 찍기')
  await page.getByTestId('se-repick').click()
  const bar = page.getByTestId('se-cap-bar')
  await expect(bar.locator('[data-cap-stage]')).toHaveCount(1)
  await expect(bar).toContainText('누를 곳 찍기')
  await expect(page.getByTestId('se-cap-hint')).toContainText('기준 화면에서 찾은 그림')
  const found = page.getByTestId('se-cap-train')
  for (const [k, v] of [['x', RESET[0]], ['y', RESET[1]], ['width', RESET[2]], ['height', RESET[3]]]) await expect(found).toHaveAttribute(k, String(v))
  await expect(page.getByTestId('se-cap-click-now')).toHaveAttribute('data-x', String(RESET[0] + 24))
  await clickAt(page, layer, RESET[0] + 100, RESET[1] + 40)
  await expect(bar).toHaveCount(0)
  const clickY = panel.getByTestId('se-click-y')
  const y = Number(await clickY.inputValue())
  expect(Math.abs(y - 40)).toBeLessThanOrEqual(4) // 화면 1px ≈ 기준 화면 몇 px
  await expect(cellOf(page, 's0', 'no').locator('[data-mark="pending"]')).toHaveCount(1)

  // ── 패널을 고친 채 다른 줄을 누르면 확인 창 → [적용하고 이동] ──
  await cellOf(page, 's2', 'no').click()
  const guard = page.getByTestId('se-guard')
  await expect(guard).toContainText('2번 스텝에 적용하지 않은 변경이 있습니다')
  await guard.getByTestId('se-guard-apply').click()
  await expect(guard).toHaveCount(0)
  await expect(rowOf(page, 's2')).toHaveClass(/ag-row-selected/)
  await expect(cellOf(page, 's0', 'no').locator('[data-mark="ch"]')).toHaveCount(1)

  // ── 되돌리기(Ctrl+Z)·다시 하기(도구 줄) ──
  await page.getByTestId('se-step-table').focus()
  await page.keyboard.press('Control+z')
  await expect(toast(page)).toHaveText('되돌렸습니다.')
  await expect(cellOf(page, 's0', 'no').locator('[data-mark]')).toHaveCount(0)
  await expect(rowOf(page, 's0')).toHaveClass(/ag-row-selected/) // 적용할 때의 줄로 돌아간다
  await expect(clickY).toHaveValue('12')
  await page.getByTestId('se-tool-redo').click()
  await expect(toast(page)).toHaveText('다시 했습니다.')
  await expect(cellOf(page, 's0', 'no').locator('[data-mark="ch"]')).toHaveCount(1)
  await expect(rowOf(page, 's2')).toHaveClass(/ag-row-selected/) // 되돌리기를 누를 때의 줄로
  await selectRow(page, 's0')
  await expect(clickY).toHaveValue(String(y))

  // ── 화면에서 만든 작업본으로 검사(/check): 막힘 없음, 고친 스텝 = 새 스텝·붙인 스텝·누를 곳을 고친 1번 ──
  // /check 응답(blocks·warns·target·conflict·targetExists)에는 고친 스텝 목록이 없다 — 서버 changeDetect 와 같은 기준의 화면 변경 목록(unsavedChanges)과
  // "손대지 않은 스텝은 저장 기준점과 같은 객체"(서버가 원래 값을 그대로 쓰는 조건)로 본다.
  // 모듈은 Vite 개발 서버 주소로 불러온다 — 앱이 불러온 것과 같은 주소라 같은 모듈·같은 Pinia 저장소다(빌드한 앱을 E2E_BASE_URL 로 시험하면 이 단계는 못 한다).
  const r = await page.evaluate(async () => {
    const { useEditStore } = await import('/src/features/scenario-editor/stores/editStore.js')
    const { buildMeta, buildFormData } = await import('/src/features/scenario-editor/editor/request.js')
    const { unsavedChanges } = await import('/src/features/scenario-editor/editor/diff.js')
    const { scenarioEditorApi } = await import('/src/features/scenario-editor/api.js')
    const edit = useEditStore()
    const s = edit.session
    const { meta, uploadsUsed } = buildMeta(s)
    const res = (await scenarioEditorApi.check(meta)).data.data
    const fd = buildFormData(meta, edit.uploads, uploadsUsed)
    const files = await Promise.all([...fd.entries()].filter(([k]) => k !== 'meta').map(async ([k, f]) => ({ k, name: f.name, type: f.type, head: [...new Uint8Array(await f.slice(0, 4).arrayBuffer())] })))
    return {
      res, uploadsUsed, files, topKeys: Object.keys(meta).sort(),
      changes: unsavedChanges(s.working, s.saveBase).map((c) => `${c.kind}:${c.uid}`).sort(),
      sameObject: s.working.steps.filter((st) => s.saveBase.steps.includes(st)).map((st) => st.uid)
    }
  })
  expect(r.res.blocks).toEqual([])
  expect(r.res.conflict).toBeNull()
  expect(r.res.target.exists).toBe(true)
  expect(r.topKeys).toEqual(['propertyRev', 'scenario', 'target'])
  expect(r.changes).toEqual([`added:${added}`, `added:${pasted}`, 'changed:s0'].sort())
  expect(r.sameObject).toEqual(['s1', 's2', 's3', 's4'])
  // 올릴 그림: 새 스텝이 잡은 찾을 그림 하나 — 실제 PNG(canvas 로 자른 것)
  expect(r.uploadsUsed).toHaveLength(1)
  expect(r.files).toEqual([{ k: `img:${r.uploadsUsed[0]}`, name: `${r.uploadsUsed[0]}.png`, type: 'image/png', head: [0x89, 0x50, 0x4e, 0x47] }])
})

test('② WRITE 가 없으면(sew_cvd) 도구 줄·편집 패널·갈 곳 고르기가 없다', async ({ page }) => {
  await asUser(page, 'sew_cvd')
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=NEXT_RULES&v=current')
  await expect(rows(page)).toHaveCount(5)
  await expect(page.getByTestId('se-toolbar')).toHaveCount(0)
  await expect(page.getByTestId('se-detail')).not.toHaveAttribute('data-panel', 'edit')
  await expect(page.locator('[data-testid="se-step-table"] [data-pick]')).toHaveCount(0)
  await selectRow(page, 's3')
  await page.getByTestId('se-step-table').focus()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('se-delblock')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(5)
})

// 찾을 그림 밖 누를 곳(2026-11-08 사용자 보고, A + B). ALL_ACTIONS 1번(누를 곳 24,12 — 안)·3번(오른쪽 클릭 -3,7 — 밖), 찾을 그림 = Reset 단추.
// 기준 화면에서 찾을 그림을 한 곳 찾으면(위치 찾기) 썸네일의 넓힌 곳을 실제 기준 화면으로 채우고 큰 화면에 찾은 그림·누를 곳을 늘 그린다.
async function loadedImg(loc) {
  return loc.evaluate((img) => img.complete && img.naturalWidth > 0)
}
test('③ 찾을 그림 밖 누를 곳: 썸네일을 넓혀 + 를 그리고 주변을 기준 화면으로 채우며 큰 화면에 누를 곳을 늘 그린다(편집·읽기 전용)', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=ALL_ACTIONS&v=current')
  await expect(page.getByTestId('se-bar-id')).toContainText('ALL_ACTIONS') // 18줄 — 표는 보이는 줄만 그린다
  await selectRow(page, 's0')
  const panel = page.getByTestId('se-detail')
  await expect(panel).toHaveAttribute('data-panel', 'edit')
  const thumb = panel.locator('[data-station="find"] [data-train-key="0"]')
  const spotTrain = page.getByTestId('se-spot-train')
  const spotClick = page.getByTestId('se-spot-click')

  // 그림 안(24,12): 썸네일은 그대로(너비 110, 넓히지 않음), 큰 화면에는 찾은 그림·누를 곳
  await expect(thumb.getByTestId('se-click-marker')).toBeVisible()
  await expect(thumb).not.toHaveAttribute('data-expand')
  expect(Math.round((await thumb.boundingBox()).width)).toBe(110)
  for (const [k, v] of [['x', RESET[0]], ['y', RESET[1]], ['width', RESET[2]], ['height', RESET[3]]]) await expect(spotTrain).toHaveAttribute(k, String(v))
  await expect(spotClick).toHaveAttribute('data-x', String(RESET[0] + 24))
  await expect(spotClick).toHaveAttribute('data-y', String(RESET[1] + 12))
  await expect(page.getByTestId('se-spot')).toContainText('누를 곳')
  await expect(panel.getByTestId('se-train-outside')).toHaveCount(0)

  // 패널 X 를 그림 너비(255)보다 크게: 썸네일이 그 지점까지 넓어지고 넓힌 곳은 기준 화면, + 가 보인다. 큰 화면 + 도 따라간다.
  const clickX = panel.locator('[data-field="click"]')
  await clickX.fill('300')
  await clickX.press('Tab')
  await expect(thumb).toHaveAttribute('data-expand', 'base')
  const around = thumb.getByTestId('se-crop-around')
  await expect.poll(() => loadedImg(around)).toBe(true)
  expect(await around.evaluate((img) => [img.naturalWidth, img.naturalHeight])).toEqual([IMG.w, IMG.h])
  const box = await thumb.boundingBox()
  expect(box.width).toBeGreaterThan(110)
  expect(box.width).toBeLessThanOrEqual(300)
  expect(box.height).toBeLessThanOrEqual(150)
  const m = await thumb.getByTestId('se-click-marker').boundingBox()
  const mx = m.x + m.width / 2
  const my = m.y + m.height / 2
  expect(mx).toBeGreaterThan(box.x + box.width * 0.7) // 오른쪽으로 넓힌 곳에
  expect(mx).toBeLessThan(box.x + box.width)
  expect(my).toBeGreaterThan(box.y)
  expect(my).toBeLessThan(box.y + box.height)
  await expect(thumb.getByTestId('se-crop-train')).toBeVisible()
  await expect(panel.getByTestId('se-train-outside')).toContainText('누를 곳: 찾을 그림 밖 (300, 12)')
  await expect(panel.getByTestId('se-train-outside')).toContainText('주변 화면: 기준 화면에서 찾은 자리')
  await expect(spotClick).toHaveAttribute('data-x', String(RESET[0] + 300))
  await expect(spotTrain).toHaveAttribute('x', String(RESET[0])) // 누를 곳만 바꿨으니 찾은 자리는 그대로

  // 다시 그림 안으로: 넓히지 않는다
  await clickX.fill('24')
  await clickX.press('Tab')
  await expect(thumb).not.toHaveAttribute('data-expand')
  expect(Math.round((await thumb.boundingBox()).width)).toBe(110)

  // 읽기 전용(WRITE 없음 sew_cvd, P1 상세): 3번(-3,7)은 저장값 그대로 밖 — 넓혀 기준 화면으로 채우고 큰 화면에 그린다
  await asUser(page, 'sew_cvd')
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=ALL_ACTIONS&v=current')
  await expect(page.getByTestId('se-bar-id')).toContainText('ALL_ACTIONS') // 18줄 — 표는 보이는 줄만 그린다
  await selectRow(page, 's2')
  const detail = page.getByTestId('se-detail')
  await expect(detail).not.toHaveAttribute('data-panel', 'edit')
  const ro = detail.locator('[data-train-key="0"]')
  await expect(ro).toHaveAttribute('data-expand', 'base')
  await expect(ro.getByTestId('se-click-marker')).toBeVisible()
  await expect.poll(() => loadedImg(ro.getByTestId('se-crop-around'))).toBe(true)
  await expect(detail).toContainText('클릭 지점: 학습 이미지 밖 (-3, 7)')
  await expect(detail.getByTestId('se-detail-spot')).toHaveText('주변 화면: 기준 화면에서 찾은 자리')
  await expect(spotClick).toHaveAttribute('data-x', String(RESET[0] - 3))
  await expect(spotClick).toHaveAttribute('data-y', String(RESET[1] + 7))
  await expect(page.getByTestId('se-spot')).toContainText('클릭 지점')
})
