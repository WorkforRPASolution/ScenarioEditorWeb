import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, selectRow, drag } from './helpers'
import { JUDGE_CONTROL_URL } from '../env.js'

// P4 Vision·OCR 시험(설계 §4, §11 E2E). 판정 서버는 흉내(tools/infra/fake-vision-judge-server.js — 설정이 띄운다): Vision 은 화면 조각 안의
// 똑같은 픽셀을 찾아 점수 1 로, OCR 은 제어 값의 줄(기본 READY)을 사내 규칙으로 판정한다. 길: 화면 → 웹 백엔드 → InterfaceServer(gRPC) → 흉내.
// 시험 데이터: basic ALL_CONDITIONS(1 이미지 — 영역 DIALOG·찾을 그림 RESET·누를 곳 24:12 · 2 OCR — 글 같음 "IDLE"), 기준 화면 alarm.png(1920×1200),
// 스냅샷 SEWT_PHOTO_A01(640×360, `npm run seed -- snapshots`). 시험은 아무것도 저장하지 않는다 — 치울 것이 없다.
const RESET = [711, 660, 255, 96] // 찾을 그림의 기준 화면 자리(tools/scenario-gen/scenarios/basic.js)
const CLICK = [RESET[0] + 24, RESET[1] + 12]

const judge = async (method, path, body) => {
  const res = await fetch(`${JUDGE_CONTROL_URL}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error(`judge control ${method} ${path} → ${res.status}`)
  return res.json()
}
const calls = () => judge('GET', '/calls')
test.beforeEach(async () => { await judge('POST', '/reset') })

const row = (page) => page.getByTestId('se-test')
const run = (page) => page.getByTestId('se-test-run')
const head = (page) => page.getByTestId('se-test-head')
const result = (page) => page.getByTestId('se-test-result')
const cells = (page) => page.getByTestId('se-test-row').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
// 겹침 상자의 화면 자리가 그림 픽셀 (x, y, w, h) 와 맞는가 — 테두리가 상자 안쪽에 그려지므로 바깥 치수로 견준다
async function expectOnImage(box, image, [x, y, w, h], size) {
  const img = await image.boundingBox()
  const b = await box.boundingBox()
  const k = img.width / size.w
  expect(Math.abs(b.x - (img.x + x * k))).toBeLessThan(1.5)
  expect(Math.abs(b.y - (img.y + y * k))).toBeLessThan(1.5)
  expect(Math.abs(b.width - w * k)).toBeLessThan(1.5)
  expect(Math.abs(b.height - h * k)).toBeLessThan(1.5)
}
// 모드 탭은 두 보기에 하나씩 있다(하나는 숨어 있다) — 보이는 쪽
const modeTab = (page, mode) => page.locator(`[data-testid="se-mode-${mode}"]:visible`)
// 상자의 자리가 더 바뀌지 않을 때까지 기다린다(보기가 다시 보이며 확대를 맞추는 동안 끌면 좌표가 어긋난다)
async function settled(locator) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await locator.boundingBox())
    const same = now === last && now !== 'null'
    last = now
    return same
  }, { intervals: [150] }).toBe(true)
}
const BASE = { w: 1920, h: 1200 }
const SNAP = { w: 640, h: 360 }

async function openConditions(page, user = 'sew_master') {
  await asUser(page, user)
  await page.goto('/scenario-editor')
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_CONDITIONS')
  await expect(rows(page)).toHaveCount(4)
}

test('① 이미지 스텝 시험 — 찾은 곳 사각형·누를 곳·표 → 정확도 바꿔 다시 시험 → [스텝에 넣기] → 값이 바뀌면 흐림 → 다른 스텝으로 가면 지워짐', async ({ page }) => {
  await openConditions(page)
  await selectRow(page, 's0')
  const panel = page.getByTestId('se-detail')
  const viewer = page.getByTestId('se-viewer')
  await expect(row(page)).toHaveAttribute('data-kind', 'image')
  await expect(row(page)).toContainText('패널의 지금 값으로, 저장하지 않고')
  const stored = await panel.locator('[data-field="accept"]').inputValue()
  await expect(page.getByTestId('se-test-accept')).toHaveValue(stored)
  await expect(page.getByTestId('se-test-apply')).toBeDisabled()
  await expect(page.getByTestId('se-test-screen')).toHaveValue('base')
  await expect(page.getByTestId('se-test-screen').locator('option[value="snapshot"]')).toBeDisabled() // 떠 있는 스냅샷이 없다
  // 평소에는 브라우저가 찾은 "찾은 그림" 표시가 있다
  await expect(viewer.getByTestId('se-spot')).toBeVisible()

  // ── 시험: 흉내가 화면 조각에서 찾을 그림을 한 곳 찾는다 → 기준 화면 좌표로 ──
  await run(page).click()
  await expect(head(page)).toHaveText(/^1곳 찾음 · \d+ms$/)
  await expect(head(page)).toHaveAttribute('data-ok', 'true')
  expect(await cells(page)).toEqual([['1 · 누를 곳', '1.0000', String(RESET[0]), String(RESET[1])]])
  await expect(result(page)).toContainText('시험은 그림이 화면에 보이는지만 봅니다')
  await expect(page.getByTestId('se-test-rule')).toHaveCount(0) // 마우스 클릭 스텝 — 다중 검사가 걸리지 않는다
  // 큰 화면: 찾을 그림 크기의 사각형과 누를 곳, 평소의 찾은 그림 표시는 숨는다
  const hit = viewer.getByTestId('se-test-hit')
  await expect(hit).toHaveCount(1)
  await expectOnImage(hit, page.getByTestId('se-base-image'), RESET, BASE)
  const dot = viewer.getByTestId('se-test-click')
  await expect(dot).toHaveAttribute('data-x', String(CLICK[0]))
  await expect(dot).toHaveAttribute('data-y', String(CLICK[1]))
  const img = await page.getByTestId('se-base-image').boundingBox()
  const d = await dot.boundingBox()
  expect(Math.abs(d.x + d.width / 2 - (img.x + (CLICK[0] / BASE.w) * img.width))).toBeLessThan(2)
  expect(Math.abs(d.y + d.height / 2 - (img.y + (CLICK[1] / BASE.h) * img.height))).toBeLessThan(2)
  await expect(viewer.getByTestId('se-spot')).toHaveCount(0)
  await expect(page.getByTestId('se-test-view-hint')).toBeVisible()
  // 판정 서버에 간 것: 영역 조각 + 찾을 그림, 패널의 정확도, 사내와 같은 값(개수 20·Timeout 2000)
  let sent = await calls()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ rpc: 'RequestVision', cancelled: false, param: { MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true } })
  expect(sent[0].param.AcceptThreshold).toBeCloseTo(Number(stored), 5)

  // ── 시험 정확도만 바꾸면 결과가 흐려지고, 다시 시험하면 그 값으로 간다 ──
  await page.getByTestId('se-test-accept').fill('0.95')
  await expect(result(page)).toHaveAttribute('data-stale', 'true')
  await expect(page.getByTestId('se-test-stale')).toHaveText('값이 바뀌었습니다 — 다시 시험하세요.')
  await expect(viewer.getByTestId('se-test-layer')).toHaveAttribute('data-stale', 'true')
  await run(page).click()
  await expect(result(page)).toHaveAttribute('data-stale', 'false')
  await expect(head(page)).toHaveText(/^1곳 찾음/)
  sent = await calls()
  expect(sent).toHaveLength(2)
  expect(sent[1].param.AcceptThreshold).toBeCloseTo(0.95, 5)

  // ── [스텝에 넣기]: 패널의 정확도 칸에만 — 적용 줄이 뜨고(되돌릴 수 있다) 결과는 그대로다 ──
  await expect(page.getByTestId('se-test-apply')).toBeEnabled()
  await page.getByTestId('se-test-apply').click()
  await expect(panel.locator('[data-field="accept"]')).toHaveValue('0.95')
  await expect(page.getByTestId('se-panel-foot')).toBeVisible()
  await expect(page.getByTestId('se-test-apply')).toBeDisabled()
  await expect(result(page)).toHaveAttribute('data-stale', 'false')

  // ── 0.5 아래: 경고만 뜨고 시험은 된다. 0~1 밖이면 [시험] 이 꺼지고 까닭이 보인다 ──
  await page.getByTestId('se-test-accept').fill('0.4')
  await expect(page.getByTestId('se-test-accept-low')).toBeVisible()
  await expect(run(page)).toBeEnabled()
  await expect(page.getByTestId('se-test-apply')).toBeDisabled()
  await page.getByTestId('se-test-accept').fill('1.5')
  await expect(run(page)).toBeDisabled()
  await expect(run(page)).toHaveAttribute('title', '시험 정확도는 0 에서 1 사이의 수여야 합니다.')

  // ── [닫기] → 평소의 찾은 그림 표시가 돌아온다 ──
  await page.getByTestId('se-test-close').click()
  await expect(result(page)).toHaveCount(0)
  await expect(viewer.getByTestId('se-test-hit')).toHaveCount(0)
  await expect(viewer.getByTestId('se-spot')).toBeVisible()

  // ── 다시 시험한 뒤 다른 스텝으로 가면 결과가 남지 않는다(패널의 바뀐 값은 되돌리고 간다) ──
  await page.getByTestId('se-panel-revert').click()
  await expect(page.getByTestId('se-test-accept')).toHaveValue('1.5') // 손댄 시험 칸은 그대로
  await page.getByTestId('se-test-accept').fill(stored)
  await run(page).click()
  await expect(head(page)).toHaveText(/^1곳 찾음/)
  await selectRow(page, 's1')
  await expect(row(page)).toHaveAttribute('data-kind', 'ocr')
  await expect(result(page)).toHaveCount(0)
  await expect(viewer.getByTestId('se-test-hit')).toHaveCount(0)
  await selectRow(page, 's2') // 조건 없음 — 시험 줄이 없다
  await expect(row(page)).toHaveCount(0)
})

test('② 지금 스냅샷으로 시험 — 영역이 스냅샷에 다 들어오지 않으면 보내지 않음 → 영역을 다시 잡아 시험 → 0건 안내 → 찾은 곳은 스냅샷 좌표로 → 다른 스냅샷을 고르면 지워짐', async ({ page }) => {
  await openConditions(page)
  await selectRow(page, 's0')
  const viewer = page.getByTestId('se-viewer')
  const shot = page.getByTestId('se-snap-viewer')

  // ── 스냅샷을 고르면 "지금 스냅샷" 을 고를 수 있다 ──
  await page.getByTestId('se-snapshot-rail').click()
  await page.getByTestId('se-snap-eqp-input').click()
  await page.getByTestId('se-snap-eqp-input').fill('photo_a')
  await page.locator('[data-testid="se-snap-eqp-option"][data-eqp="SEWT_PHOTO_A01"]').click()
  await page.getByTestId('se-snap-row').filter({ hasText: '09:13:02' }).click()
  await expect(page.getByTestId('se-snap-image')).toBeVisible()
  await page.getByTestId('se-test-screen').selectOption('snapshot')
  // 스냅샷 위에 이 스텝의 검색 영역(기준 화면 좌표 그대로 — 640×360 스냅샷의 오른쪽 아래로 넘친다)
  await expect(shot.getByTestId('se-test-area')).toBeVisible()
  await expectOnImage(shot.getByTestId('se-test-area'), page.getByTestId('se-snap-image'), [560, 320, 880, 520], SNAP)

  // ── 영역이 스냅샷 안에 80×40 만 걸친다(찾을 그림 255×96 보다 작다) → 보내지 않고 까닭을 알린다 ──
  await run(page).click()
  await expect(page.getByTestId('se-test-error')).toHaveText('검색 영역이 이 화면 안에 다 들어오지 않습니다.')
  expect(await calls()).toHaveLength(0)

  // ── 영역을 스냅샷 안에 들어오게 다시 잡는다(찾을 그림은 그대로) — 잡기를 시작하면 큰 화면이 스텝 그림으로 오고, 영역이 바뀌어 앞 결과가 지워진다 ──
  await page.getByTestId('se-cap-look').click()
  const layer = page.getByTestId('se-capture-layer')
  await expect(layer).toHaveAttribute('data-stage', 'area')
  await settled(layer) // 스냅샷 보기에서 막 돌아와 그림을 다시 맞추는 중일 수 있다
  await drag(page, layer, [12, 12, 600, 330])
  await expect(layer).toHaveAttribute('data-stage', 'train')
  await page.getByTestId('se-cap-keep').click()
  await expect(page.getByTestId('se-cap-bar')).toHaveCount(0)
  await expect(result(page)).toHaveCount(0)
  await expect(modeTab(page, 'step')).toHaveAttribute('aria-pressed', 'true')
  const area = await page.getByTestId('se-detail').locator('[data-station="look"]').innerText()
  const [ax, ay] = /X\s*(\d+)[^\d]+Y\s*(\d+)/.exec(area).slice(1).map(Number) // 끌어 잡은 영역의 왼쪽 위(픽셀로 맞춰진 값)

  // ── [시험] 을 누르면 큰 화면이 스냅샷으로 간다. 이 스냅샷에는 그 그림이 없다 → 못 찾음(붉음)과 안내 ──
  await run(page).click()
  await expect(head(page)).toHaveText(/^찾지 못했습니다 · \d+ms$/)
  await expect(head(page)).toHaveAttribute('data-ok', 'false')
  await expect(result(page)).toContainText('판정 서버가 그림을 읽지 못했을 때도 못 찾은 것으로 답합니다.')
  await expect(modeTab(page, 'snapshot')).toHaveAttribute('aria-pressed', 'true')
  await expect(shot.getByTestId('se-test-hit')).toHaveCount(0)
  expect(await calls()).toHaveLength(1)

  // ── 판정 서버가 두 곳을 찾았다고 답하면(조각 기준·소수) 스냅샷 좌표로 그린다: 조각의 왼쪽 위 + 소수 버림 ──
  await judge('PUT', '/control', { visionResults: [{ success: true, Score: 0.91234, TX: 100.7, TY: 50.2 }, { success: true, Score: 0.9, TX: 300, TY: 200.9 }] })
  await run(page).click()
  await expect(head(page)).toHaveText(/^2곳 찾음/)
  expect(await cells(page)).toEqual([
    ['1 · 누를 곳', '0.9123', String(ax + 100), String(ay + 50)],
    ['2', '0.9000', String(ax + 300), String(ay + 200)]
  ])
  const hits = shot.getByTestId('se-test-hit')
  await expect(hits).toHaveCount(2)
  await expectOnImage(hits.nth(0), page.getByTestId('se-snap-image'), [ax + 100, ay + 50, RESET[2], RESET[3]], SNAP)
  await expectOnImage(hits.nth(1), page.getByTestId('se-snap-image'), [ax + 300, ay + 200, RESET[2], RESET[3]], SNAP)
  await expect(shot.getByTestId('se-test-click')).toHaveAttribute('data-x', String(ax + 100 + 24))
  // 표의 줄을 누르면 그 사각형이 굵어진다
  await page.getByTestId('se-test-row').nth(1).click()
  await expect(hits.nth(1)).toHaveAttribute('data-picked', 'true')
  await expect(hits.nth(0)).toHaveAttribute('data-picked', 'false')

  // ── 결과는 시험한 화면의 모드에서만: 스텝 그림에는 없고, 스냅샷으로 돌아오면 다시 보인다 ──
  await modeTab(page, 'step').click()
  await expect(viewer.getByTestId('se-test-hit')).toHaveCount(0)
  await expect(result(page)).toBeVisible()
  await modeTab(page, 'snapshot').click()
  await expect(shot.getByTestId('se-test-hit')).toHaveCount(2)

  // ── 다른 스냅샷을 고르면 앞 스냅샷의 결과가 남지 않는다(영역 테두리는 그대로) ──
  await page.getByTestId('se-snap-row').filter({ hasText: '22:00:00' }).click()
  await expect(result(page)).toHaveCount(0)
  await expect(shot.getByTestId('se-test-hit')).toHaveCount(0)
  await expect(shot.getByTestId('se-test-area')).toBeVisible()
})

test('③ OCR 스텝 시험 — 안 맞음·읽은 글·신뢰도 → 맞음 → 패널 값을 바꾸면 흐림', async ({ page }) => {
  await openConditions(page)
  await selectRow(page, 's1')
  const panel = page.getByTestId('se-detail')
  await expect(row(page)).toHaveAttribute('data-kind', 'ocr')
  await expect(page.getByTestId('se-test-accept')).toHaveCount(0)

  // ── 흉내가 READY 를 읽는다 — 스텝은 "IDLE 과 같음" → 안 맞음 ──
  await run(page).click()
  await expect(head(page)).toHaveText(/^안 맞음 · \d+ms$/)
  await expect(head(page)).toHaveAttribute('data-ok', 'false')
  await expect(page.getByTestId('se-test-line')).toHaveText(['READY'])
  await expect(page.getByTestId('se-test-conf')).toContainText('신뢰도 — 가장 낮은 값 95')
  await expect(page.getByTestId('se-test-conf')).toContainText('글자별 95 95 95 95 95')
  await expect(page.getByTestId('se-viewer').getByTestId('se-test-layer')).toHaveCount(0) // 큰 화면에는 더 그리지 않는다
  let sent = await calls()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ rpc: 'RequestOcr', param: { OcrValueType: 1, OcrOperation: 1, MinMatchingValue: 10 } })
  expect(sent[0].param.TextValue).toMatch(/^IDLE(@@@@\d+-[012])?$/) // 배포될 값 그대로(다중 검사 접미사는 저장값에 있을 때)

  // ── 화면에 IDLE 이 두 줄 있으면 맞음 ──
  await judge('PUT', '/control', { ocrLines: ['IDLE', 'IDLE 2'], ocrConfidence: 88 })
  await run(page).click()
  await expect(head(page)).toHaveText(/^맞음 · \d+ms$/)
  await expect(head(page)).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('se-test-line').first()).toHaveText('IDLE')
  await expect(page.getByTestId('se-test-conf')).toContainText('가장 낮은 값 88')

  // ── 패널에서 비교할 글을 바꾸면 결과가 흐려지고, 다시 시험하면 그 값으로 간다(스텝을 고쳤으니 접미사가 붙는다) ──
  await panel.locator('[data-field="ocrVal"]').fill('RUN')
  await expect(result(page)).toHaveAttribute('data-stale', 'true')
  await run(page).click()
  await expect(head(page)).toHaveText(/^안 맞음/)
  sent = await calls()
  expect(sent[sent.length - 1].param.TextValue).toMatch(/^RUN@@@@\d+-[012]$/)
  // 값을 지우면 [시험] 이 꺼진다
  await panel.locator('[data-field="ocrVal"]').fill('')
  await expect(run(page)).toBeDisabled()
  await expect(run(page)).toHaveAttribute('title', '비교할 값을 바르게 넣으세요.')
})

test('④ 읽기 전용(쓰기 권한 없는 sew_cvd)에서도 시험한다 — 저장된 값으로, [스텝에 넣기] 는 없다', async ({ page }) => {
  await openConditions(page, 'sew_cvd')
  await selectRow(page, 's0')
  await expect(page.getByTestId('se-detail')).not.toHaveAttribute('data-panel', 'edit')
  await expect(row(page)).toContainText('저장된 값으로')
  await expect(page.getByTestId('se-test-apply')).toHaveCount(0)
  await run(page).click()
  await expect(head(page)).toHaveText(/^1곳 찾음 · \d+ms$/)
  expect(await cells(page)).toEqual([['1 · 누를 곳', '1.0000', String(RESET[0]), String(RESET[1])]])
  const hit = page.getByTestId('se-viewer').getByTestId('se-test-hit')
  await expect(hit).toHaveCount(1)
  await expectOnImage(hit, page.getByTestId('se-base-image'), RESET, BASE)
  await expect(page.getByTestId('se-viewer').getByTestId('se-spot')).toHaveCount(0)
  // OCR 스텝도
  await selectRow(page, 's1')
  await run(page).click()
  await expect(head(page)).toHaveText(/^안 맞음/)
})

test('⑤ 판정 서버가 없으면 10초 뒤 까닭을 알린다 — 앞의 결과는 남지 않고, 판정 서버가 돌아오면 다시 된다', async ({ page }) => {
  await openConditions(page)
  await selectRow(page, 's0')
  await run(page).click()
  await expect(head(page)).toHaveText(/^1곳 찾음/)
  await judge('PUT', '/judge/off')
  try {
    await page.waitForTimeout(700) // InterfaceServer 가 노드가 사라진 것을 알아챌 틈
    await run(page).click()
    await expect(page.getByTestId('se-test-progress')).toHaveText(/^시험 중… \d+초$/)
    await expect(run(page)).toBeDisabled()
    await expect(page.getByTestId('se-test-error')).toHaveText('판정 서버가 10초 안에 답하지 않았습니다. 판정 서버가 없거나, 오류가 났거나, 늦습니다.', { timeout: 20_000 })
    await expect(head(page)).toHaveCount(0)
    await expect(page.getByTestId('se-viewer').getByTestId('se-test-hit')).toHaveCount(0)
  } finally {
    await judge('PUT', '/judge/on')
    await page.waitForTimeout(700)
  }
  await run(page).click()
  await expect(head(page)).toHaveText(/^1곳 찾음/, { timeout: 20_000 })
})
