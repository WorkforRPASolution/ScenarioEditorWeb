import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const expected = (set, name) => JSON.parse(readFileSync(join(ROOT, 'tools/scenario-gen/out', set, name, 'expected.json'), 'utf8'))

export async function asUser(page, singleid) {
  await page.addInitScript((u) => { localStorage.setItem('se-dev-user', u); localStorage.setItem('se-hint-base-image', '1') }, singleid)
}

// 불러오기 창에서 연다. leave = 'drop' 이면 저장 전 변경 확인 창(설계 §4.2 떠날 때 확인)에서 [버리고 열기]를 누른다.
export async function openFromDialog(page, process, model, name, { leave = null } = {}) {
  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption(process)
  await page.getByTestId('se-load-model').selectOption(model)
  await page.getByTestId('se-load-search').fill(name)
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name, exact: true }).dblclick()
  if (leave === 'drop') {
    await expect(page.getByTestId('se-leave')).toContainText('저장하지 않은 변경이 있습니다')
    await page.getByTestId('se-leave-drop').click()
  }
  await page.getByTestId('se-bar-id').filter({ hasText: `${process}-${model}-${name}` }).waitFor()
}

// ── 스텝 표(AG Grid). 서버 uid 는 s0…(위치), 브라우저가 만든 스텝은 n…·p…. ──
const table = '[data-testid="se-step-table"] .ag-center-cols-container'
export const rows = (page) => page.locator(`${table} .ag-row`)
export const rowAt = (page, i) => page.locator(`${table} .ag-row[row-index="${i}"]`)
export const rowOf = (page, uid) => page.locator(`${table} .ag-row[row-id="${uid}"]`)
export const cellOf = (page, uid, col) => rowOf(page, uid).locator(`[col-id="${col}"]`)
export const toast = (page) => page.getByTestId('se-toast')
// 표 순서(uid). AG Grid 행 DOM 순서는 보장되지 않아 row-index 로 정렬한다.
export const order = (page) => rows(page).evaluateAll((els) => els.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index'))).map((r) => r.getAttribute('row-id')))
// 열 하나의 글자를 표 순서대로
export const column = (page, col) => rows(page).evaluateAll((els, c) => els.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
  .map((r) => r.querySelector(`[col-id="${c}"]`)?.innerText.trim() ?? ''), col)

// 한 줄 고르기. AG Grid 는 cellClicked 를 0ms 타이머로 넘기므로 고른 표시가 뜰 때까지 기다린다(단축키·도구 줄 전에).
export async function selectRow(page, uid) {
  await cellOf(page, uid, 'no').click()
  await expect(rowOf(page, uid)).toHaveClass(/ag-row-selected/)
}
export async function menu(page, opener, item) {
  await page.getByTestId(opener).click()
  await page.getByTestId('se-tool-menu').locator(item).click()
}
// 다음 스텝 칸의 고르기 창으로 갈 곳을 바꾼다(to = 스텝 uid)
export async function pickNext(page, uid, col, to) {
  await cellOf(page, uid, col).locator('[data-pick]').click()
  await page.getByTestId('se-picker').locator(`[data-to="${to}"]`).click()
}

// 큰 화면 잡기 층 위의 기준 화면 픽셀 → 화면 좌표(층은 확대·이동이 들어간 상자 안에 있다). 기준 화면은 alarm.png(1920×1200).
// size = 기준 화면 크기 — 스냅샷으로 만든 스텝은 스냅샷 크기(시험 스냅샷 640×360)를 준다.
export const BASE_IMG = { w: 1920, h: 1200 }
export async function toScreen(layer, x, y, size = BASE_IMG) {
  const b = await layer.boundingBox()
  return { x: b.x + (x * b.width) / size.w, y: b.y + (y * b.height) / size.h }
}
export async function drag(page, layer, [x, y, w, h], size = BASE_IMG) {
  const a = await toScreen(layer, x, y, size)
  const z = await toScreen(layer, x + w, y + h, size)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(z.x, z.y, { steps: 6 })
  await page.mouse.up()
}
export async function clickAt(page, layer, x, y, size = BASE_IMG) {
  const p = await toScreen(layer, x, y, size)
  await page.mouse.click(p.x, p.y)
}
