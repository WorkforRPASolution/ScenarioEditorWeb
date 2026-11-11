import { test, expect } from '@playwright/test'
import { asUser, openFromDialog, rows, toast } from './helpers'
import { sewName, idOf, urlOf, apiAs, db, cleanup, leftovers, NONE_LEFT, closeDb } from './sew'

// P2-F 전처리 설정(대상 창·숨길 창) — 설계 p2f-preprocessing-design §7·§10.
// 시드 basic PREPROCESS_WINDOWS(대상 창 'EQ Control*' + 숨길 창 3)·anomaly BAD_WINDOWS(대상 창 '*', 클래스 없음·앞뒤 공백·고정 크기·정상)는 읽기만 한다.
// 배포는 SEW_W_ 복사본에만 하고, 시험마다 끝나면(실패해도) 지운다(sew.js cleanup — p2-save 와 같다).
const PHOTO = { process: 'SEWPHOTO', model: 'SEWMODELB' }
const PRE = { ...PHOTO, name: 'PREPROCESS_WINDOWS' }
const BAD = { ...PHOTO, name: 'BAD_WINDOWS' }
const W = (Text, ClassName, over = {}) => ({ Text, ClassName, IsCheckRectEqual: false, Left: -18, Top: -18, Right: -18, Bottom: -18, ...over })

const bar = (page) => page.getByTestId('se-bar-preprocess')
const dlg = (page) => page.getByTestId('se-pp-dialog')
const ppRows = (page) => dlg(page).locator('tr[data-row]')
const save = (page) => page.getByTestId('se-save-dialog')
// 저장된 본문(Redis 해시 값)의 창 조건
async function storedWindows(k, crtime) {
  const c = await db()
  const body = JSON.parse(await c.redis.hget(`${k.process}-${k.model}`, `${k.name}.${crtime}`))
  return { target: body.TargetWindowCondition, hiding: body.HidingWindowConditionList }
}

let api
test.beforeAll(async () => {
  api = await apiAs('sew_master')
  await cleanup()
})
test.afterEach(async () => { await cleanup() })
test.afterAll(async () => {
  try {
    expect(await leftovers()).toEqual(NONE_LEFT)
  } finally {
    await api?.dispose()
    await closeDb()
  }
})

test('① 대상 창을 고치고 숨길 창을 넣어 [적용] → 바 요약 → 저장 창 "바뀐 것" → 다른 이름으로 배포 → 다시 열면 같은 값', async ({ page }) => {
  const AS = { ...PHOTO, name: sewName('PP') }
  await asUser(page, 'sew_master')
  await page.goto(urlOf(PRE))
  await expect(rows(page)).toHaveCount(2)
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾음 · 숨길 창 3')

  await bar(page).click()
  await expect(dlg(page)).toBeVisible()
  await expect(ppRows(page)).toHaveCount(3)
  await expect(dlg(page).getByTestId('se-pp-target-state')).toHaveText('실행을 시작할 때 제목에 "EQ Control" 가 들어 있는 창을 찾습니다(부분 일치).')
  await expect(dlg(page).getByTestId('se-pp-apply')).toBeDisabled()
  // 대상 창: 제목만 남기면 "찾지 않음" — 막지 않는다
  await dlg(page).getByTestId('se-pp-target-class').fill('')
  await expect(dlg(page).getByTestId('se-pp-target-state')).toHaveText('실행 때 찾지 않습니다 — 창 클래스가 비어 있음.')
  await dlg(page).getByTestId('se-pp-target-class').fill('WindowsForms10.Main')
  // 숨길 창: 클래스 없이 넣으면 그 자리에서 막힌다 → 클래스를 넣어 추가(앞뒤 공백은 지워진다)
  await dlg(page).getByTestId('se-pp-add').click()
  await dlg(page).getByTestId('se-pp-add-text').fill(' Notice ')
  await dlg(page).getByTestId('se-pp-add-ok').click()
  await expect(dlg(page).getByTestId('se-pp-add-error')).toContainText('클래스 이름을 넣어야 합니다')
  await dlg(page).getByTestId('se-pp-add-class').fill('NoticeWnd')
  await dlg(page).getByTestId('se-pp-add-ok').click()
  await expect(ppRows(page)).toHaveCount(4)
  await expect(ppRows(page).nth(3)).toContainText('새로 넣음')
  // 1번 줄을 고치고 2번 줄을 지운다
  await ppRows(page).nth(0).getByTestId('se-pp-row-edit').click()
  await dlg(page).getByTestId('se-pp-edit-class').fill('ScreenSaver2')
  await dlg(page).getByTestId('se-pp-edit-ok').click()
  await ppRows(page).nth(1).getByTestId('se-pp-row-delete').click()
  await expect(ppRows(page)).toHaveCount(3)
  await expect(dlg(page).getByTestId('se-pp-count')).toHaveText('3 / 20')
  await dlg(page).getByTestId('se-pp-apply').click()
  await expect(dlg(page)).toHaveCount(0)
  await expect(toast(page)).toContainText('전처리 설정을 적용했습니다')
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾음 · 숨길 창 3')
  await expect(page.getByTestId('se-bar-unsaved')).toHaveText('저장 전 2곳 바뀜')

  // 저장 창: 바뀐 것 두 줄(대상 창·숨길 창) → 다른 이름으로 배포
  await page.getByTestId('se-save').click()
  await expect(save(page)).toBeVisible()
  const changes = save(page).getByTestId('se-save-change')
  await expect(changes).toHaveCount(2)
  await expect(changes.nth(0)).toContainText('대상 창')
  await expect(changes.nth(1)).toContainText('더함 Notice / NoticeWnd')
  await expect(changes.nth(1)).toContainText('지움 (제목은 보지 않음) / TaskManagerWindow')
  await save(page).getByTestId('se-save-name').fill(AS.name)
  const go = page.getByTestId('se-save-deploy')
  await expect(go).toBeEnabled()
  await go.click()
  await expect(page.getByTestId('se-save-confirm')).toContainText(`${idOf(AS)} 을 새로 저장하고`)
  await page.getByTestId('se-save-go').click()
  await expect(page.getByTestId('se-save-result').locator('h4')).toHaveText(/설비에 배포했습니다/, { timeout: 60_000 })
  await page.getByTestId('se-save-close').click()
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(AS))
  await expect(page.getByTestId('se-bar-unsaved')).toHaveCount(0)

  // 저장된 본문: 고친 조건만 새로, 고치지 않은 3번 줄은 저장값 그대로. 원본은 그대로.
  const versions = await api.versions(AS)
  expect(versions).toHaveLength(1)
  const stored = await storedWindows(AS, versions[0].crtime)
  expect(stored.target).toEqual({ Text: 'EQ Control*', ClassName: 'WindowsForms10.Main', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 })
  expect(stored.hiding).toEqual([
    W('화면 보호기', 'ScreenSaver2'), W('Alarm Popup*', '#32770', { IsCheckRectEqual: true, Left: 100, Top: 100, Right: 500, Bottom: 400 }), W('Notice', 'NoticeWnd')
  ])
  const src = await api.open(PRE)
  expect(src.edited.header.windows.hiding).toHaveLength(3)

  // 다시 열면 같은 값
  await page.reload()
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(AS))
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾음 · 숨길 창 3')
  await bar(page).click()
  await expect(dlg(page).getByTestId('se-pp-target-class')).toHaveValue('WindowsForms10.Main')
  await expect(ppRows(page).nth(0)).toContainText('ScreenSaver2')
  await expect(ppRows(page).nth(2)).toContainText('NoticeWnd')
  await expect(ppRows(page).nth(2)).not.toContainText('새로 넣음')
})

test('② 다른 시나리오에서 숨길 창을 복사 → 붙여넣기(같은 조건은 건너뜀) → 초안 저장 → 새로고침 → 초안 이어 열면 같은 값', async ({ page }) => {
  // 붙일 곳: BAD_WINDOWS 를 복사 배포한 시나리오(숨길 창 4 — 그중 하나를 PREPROCESS_WINDOWS 것과 같은 조건으로 만든다)
  const T = { ...PHOTO, name: sewName('PV') }
  await api.deployFrom(BAD, T, (sc) => { sc.header.windows.hiding[3] = { ...sc.header.windows.hiding[3], text: '화면 보호기', className: 'ScreenSaverClass' } })

  await asUser(page, 'sew_master')
  await page.goto(urlOf(PRE))
  await expect(rows(page)).toHaveCount(2)
  await bar(page).click()
  await dlg(page).getByTestId('se-pp-copy').click()
  await expect(toast(page)).toContainText('숨길 창 3개를 복사했습니다')
  await dlg(page).getByTestId('se-pp-cancel').click()
  await expect(dlg(page)).toHaveCount(0)

  await openFromDialog(page, T.process, T.model, T.name)
  await expect(page.getByTestId('se-bar-id')).toHaveText(idOf(T))
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 4 (확인 3)')
  await bar(page).click()
  await expect(dlg(page).getByTestId('se-pp-paste')).toHaveText('붙여넣기 3')
  await dlg(page).getByTestId('se-pp-paste').click()
  await expect(toast(page)).toContainText('숨길 창 2개를 붙였습니다')
  await expect(toast(page)).toContainText('같은 조건 1개는 건너뛰었습니다')
  await expect(ppRows(page)).toHaveCount(6)
  await dlg(page).getByTestId('se-pp-apply').click()
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 6 (확인 3)')

  // 초안 저장 → 새로고침 → 불러오기 창에서 초안 이어 열기
  await page.getByTestId('se-save').click()
  await save(page).getByTestId('se-save-draft').click()
  await expect(page.getByTestId('se-save-result').locator('h4')).toHaveText(/초안을 저장했습니다/)
  await page.getByTestId('se-save-close').click()
  page.on('dialog', (d) => d.accept())
  await page.reload()
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 4 (확인 3)') // 주소의 시나리오는 현재 버전으로 열린다
  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption(T.process)
  await page.getByTestId('se-load-model').selectOption(T.model)
  await page.getByTestId('se-load-search').fill(T.name)
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name: T.name, exact: true }).dblclick()
  await page.getByTestId('se-load-choice').getByTestId('se-load-choice-draft').click()
  await expect(page.getByTestId('se-bar-draft')).toContainText('초안')
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 6 (확인 3)')
  await bar(page).click()
  await expect(ppRows(page)).toHaveCount(6)
  await expect(ppRows(page).nth(5)).toContainText('#32770')
})

test('③ 옛 값에 문제가 있는 시나리오(BAD_WINDOWS): 줄마다 이유가 보이고, 읽기 전용(옛 버전)은 볼 수만 있다', async ({ page }) => {
  await asUser(page, 'sew_master')
  await page.goto(urlOf(BAD))
  await expect(rows(page)).toHaveCount(1)
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 4 (확인 3)')
  await bar(page).click()
  await expect(dlg(page).getByTestId('se-pp-target-state')).toHaveText('실행 때 찾지 않습니다 — 창 제목이 * 하나.')
  await expect(ppRows(page).nth(0)).toContainText('찾지 않음 · 클래스 없음')
  await expect(ppRows(page).nth(1)).toContainText('제목·클래스 앞뒤 공백')
  await expect(ppRows(page).nth(2)).toContainText('고정 크기 800×508(옛 값)')
  await expect(ppRows(page).nth(3)).toContainText('찾음')
  await expect(dlg(page).getByTestId('se-pp-apply')).toBeDisabled()
  await dlg(page).getByTestId('se-pp-cancel').click()

  await expect(dlg(page)).toHaveCount(0)

  // 읽기 전용: 두 판을 가진 복사본의 옛 판을 연다 — 값은 보이고 고칠 수 없다
  const T = { ...PHOTO, name: sewName('PR') }
  await api.deployFrom(BAD, T)
  const first = Math.min(...(await api.versions(T)).map((v) => v.crtime))
  await api.deployFrom(T, T, (sc) => { sc.header.description = '둘째 판' })
  await page.goto(urlOf(T, first))
  await expect(page.getByTestId('se-bar-version')).toContainText('옛 버전')
  await expect(bar(page)).toHaveText('전처리: 대상 창 찾지 않음 · 숨길 창 4 (확인 3)')
  await bar(page).click()
  await expect(dlg(page).getByTestId('se-pp-readonly')).toHaveText('읽기 전용입니다 — 값을 볼 수만 있습니다.')
  await expect(ppRows(page)).toHaveCount(4)
  await expect(dlg(page).getByTestId('se-pp-target-text')).toBeDisabled()
  await expect(dlg(page).getByTestId('se-pp-apply')).toHaveCount(0)
  await expect(dlg(page).getByTestId('se-pp-add')).toHaveCount(0)
  await dlg(page).getByTestId('se-pp-close').click()
  await expect(dlg(page)).toHaveCount(0)
})
