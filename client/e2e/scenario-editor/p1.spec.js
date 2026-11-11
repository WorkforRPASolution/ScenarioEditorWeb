import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, expected } from './helpers'

const ACTION_KO = { MouseLeftClick: '마우스 클릭', MouseLeftDoubleClick: '두 번 클릭', MouseRightClick: '오른쪽 클릭', MouseMove: '휠', Keyboard: '키보드', Wait: '대기',
  Variable: '변수', OICommand: 'O.I. Command', FindWindow: '창 찾기', SendEmail: '메일 보내기', RunCommand: '명령 실행', CustomScript: '스크립트', FAP: 'FAP', ACS: 'ACS',
  NativeFunction: '에이전트 함수', None: '없음' }

test('① 공정 권한 안만 보이고, ALL_ACTIONS 가 표·순서도·상세·큰 화면에 기대값대로', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.goto('/scenario-editor')
  await page.getByTestId('se-load').click()
  // 이름 옆 괄호는 등록된 시나리오 수(2026-11-11) — 내 초안이 있으면 (내 초안 | 시나리오)
  await expect(page.getByTestId('se-load-process').locator('option')).toHaveText([/^SEWCVD \((\d+ \| )?\d+\)$/, /^SEWETCH \((\d+ \| )?\d+\)$/])
  await page.getByTestId('se-load-dialog').locator('[aria-label="닫기"]').click()
  await openFromDialog(page, 'SEWCVD', 'SEWMODELA', 'ALL_ACTIONS')
  // WRITE 사용자(sew_multi)의 바 버튼은 불러오기 · 새 시나리오 · 저장(P2-D). 시험 실행은 아직 없다(P3)
  await expect(page.getByTestId('se-new')).toBeVisible()
  await expect(page.getByRole('button', { name: '시험 실행', exact: true })).toHaveCount(0)

  await page.getByTestId('se-expand').click()
  const exp = expected('basic', 'ALL_ACTIONS')
  const rows = page.locator('[data-testid="se-step-table"] .ag-center-cols-container .ag-row')
  await expect(rows).toHaveCount(exp.steps.length)
  // AG Grid 행 DOM 순서는 보장되지 않으니 row-index 로 정렬해 읽는다
  const actions = await rows.evaluateAll((els) => els.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
    .map((r) => r.querySelector('[col-id="action"]').innerText.trim()))
  expect(actions).toEqual(exp.steps.map((s) => ACTION_KO[s.action]))
  await page.getByTestId('se-expand').click()

  await page.getByTestId('se-tab-flow').click()
  await expect(page.locator('[data-testid^="se-flow-node-"]')).toHaveCount(exp.steps.length)
  await page.getByTestId('se-flow-node-1').click()
  await expect(page.getByTestId('se-detail')).toContainText('마우스 클릭')
  await expect(page.getByTestId('se-detail')).toContainText('24:12')
  await expect(page.getByTestId('se-base-image')).toBeVisible()
  await expect(page.getByTestId('se-search-area')).toBeVisible()
  // 대상 창은 바의 [전처리] 버튼에 요약된다(P2-F) — 저장값이 null/null 이라 "없음", 사내 표시와 다르다는 안내는 그 아래 줄
  await expect(page.getByTestId('se-bar-preprocess')).toHaveText('전처리: 대상 창 없음 · 숨길 창 0')
  await expect(page.getByTestId('se-bar-target-window')).toContainText('사내 편집기에서는 대상 창이 "설정"으로 보이지만')
})

test('② 옛 버전을 열면 "옛 버전" 과 그 버전의 스텝', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.goto('/scenario-editor')
  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption('SEWETCH')
  await page.getByTestId('se-load-model').selectOption('SEWMODELB')
  await page.getByTestId('se-load-search').fill('MULTI_VERSION')
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name: 'MULTI_VERSION', exact: true }).click()
  const versions = page.getByTestId('se-load-version')
  await expect(versions).toHaveCount(3)
  await versions.last().dblclick()
  await expect(page.getByTestId('se-bar-version')).toContainText('옛 버전')
  await expect(page.locator('[data-testid="se-step-table"] .ag-center-cols-container .ag-row')).toHaveCount(1)
})

test('③ 미등록 사용자는 안내만', async ({ page }) => {
  await asUser(page, 'sew_none')
  await page.goto('/scenario-editor')
  await expect(page.getByTestId('se-unregistered')).toContainText('등록되지 않았습니다')
  await expect(page.getByTestId('se-bar')).toHaveCount(0)
})

test('④ 데이터 점검(시나리오를 열지 않아도)', async ({ page }) => {
  await asUser(page, 'sew_cvd')
  await page.goto('/scenario-editor')
  await expect(page.getByTestId('se-data-check')).toContainText('⚠5')
  await page.getByTestId('se-data-check').click()
  const d = page.getByTestId('se-data-check-dialog')
  for (const v of ['SEWT_DUP01', 'SEWT_BADREQ', 'SEWT_BADMAIL', 'SEWT_PRX02 = SEWT_PRX01', 'SEWCVD-SEWMODELB-DUP_PROPERTY']) await expect(d).toContainText(v)
})

test('⑤ 주소 쿼리로 다시 열고 경고 스텝을 찾는다', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=NEXT_RULES&v=current')
  await expect(page.locator('[data-testid="se-step-table"] .ag-center-cols-container .ag-row')).toHaveCount(5)
  await page.getByTestId('se-notes').click()
  await expect(page.getByTestId('se-detail')).toContainText('1번 스텝에서 출발해 닿지 않는')
  await page.reload()
  await expect(page.getByTestId('se-bar-id')).toContainText('NEXT_RULES')
})

test('⑥ 경계선 크기를 기억하고 두 번 누르면 기본값', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.goto('/scenario-editor')
  const width = async () => (await page.getByTestId('se-detail').boundingBox()).width
  const before = await width()
  const g = await page.getByTestId('se-gutter-r').boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x - 100, g.y + g.height / 2, { steps: 5 })
  await page.mouse.up()
  expect(Math.round((await width()) - before)).toBeGreaterThanOrEqual(95)
  await page.reload()
  expect(Math.round((await width()) - before)).toBeGreaterThanOrEqual(95)
  await page.getByTestId('se-gutter-r').dblclick()
  expect(Math.abs((await width()) - before)).toBeLessThan(3)
})

test('⑦ 다크 모드에서 그리드도 어둡다', async ({ page }) => {
  await asUser(page, 'sew_multi')
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
  await page.goto('/scenario-editor?p=SEWCVD&m=SEWMODELA&n=ALL_CONDITIONS&v=current')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const bg = await page.locator('[data-testid="se-step-table"] .ag-root-wrapper').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe('rgb(30, 41, 59)')
})
