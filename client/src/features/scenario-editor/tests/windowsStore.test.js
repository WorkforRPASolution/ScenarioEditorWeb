import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => p }))
import { useEditStore } from '../stores/editStore'
import { useEditorStore } from '../stores/editorStore'
import { issueGoal } from '../stores/saveFlow'
import { unsavedChanges } from '../editor/diff'
import { draftSessionOf, restoreSessionOf } from '../editor/session'
import { newScenarioOf } from '../editor/newScenario'
import { buildMeta } from '../editor/request'
import { blankWindows } from '../editor/windows'
import { MESSAGES, noteMessage, t } from '../messages'
import { panelFixture, noneStep } from './panelFixture'

// P2-F 전처리 설정 — 작업본·저장 전 변경·세션·문구(설계 §4·§7)
const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: 0, top: 0, right: 0, bottom: 0, ...over })
const row = (origin, text, className, over) => ({ origin, ...win(text, className, over) })
const WINDOWS = { target: win('EQ*', 'Main'), hiding: [row(0, 'a', 'A'), row(1, 'b', 'B')] }

// 서버가 준 작업본처럼 header.windows 를 가진 세션
function start(windows = WINDOWS, opts) {
  const f = panelFixture([noneStep(0), noneStep(1)], opts)
  const edited = { ...f.edited, header: { ...f.edited.header, windows: JSON.parse(JSON.stringify(windows)) } }
  const skeleton = { ...f.skeleton, edited }
  f.s.skeleton = skeleton
  f.e.begin(skeleton, f.s.me)
  return { ...f, edited, skeleton }
}

describe('editStore.applyWindows', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('작업본 header.windows 만 바꾼다 — 되돌리기 목록에 넣지 않고, 저장 전 변경에 잡힌다', () => {
    const { e } = start()
    expect(e.unsavedCount).toBe(0)
    const next = { target: win('EQ Main', 'Main'), hiding: [{ ...row(0, 'a', 'A'), isNew: true }, row(null, 'n', 'N')] }
    expect(e.applyWindows(next)).toBe(true)
    expect(e.session.working.header.windows).toEqual({ target: win('EQ Main', 'Main'), hiding: [row(0, 'a', 'A'), row(null, 'n', 'N')] })
    expect(e.session.working.header.windows.hiding[1]).not.toBe(next.hiding[1]) // 복사본
    expect(e.session.saveBase.header.windows).toEqual(WINDOWS)
    expect(e.undo).toHaveLength(0)
    expect(e.unsavedCount).toBe(2) // 대상 창 · 숨길 창
    expect(buildMeta(e.session).meta.scenario.header.windows).toEqual(e.session.working.header.windows)
  })
  it('읽기 전용(쓰기 권한 없음·옛 버전)이면 받지 않는다', () => {
    const ro = start(WINDOWS, { canWrite: false })
    expect(ro.e.applyWindows(blankWindows())).toBe(false)
    expect(ro.e.session.working.header.windows).toEqual(WINDOWS)
    setActivePinia(createPinia())
    const old = start(WINDOWS, { isCurrent: false })
    expect(old.e.applyWindows(blankWindows())).toBe(false)
  })
  it('복사 묶음은 다른 시나리오를 열어도 남는다(스텝 복사와 같다) — 일곱 칸만 담는다', () => {
    const { e, s, skeleton } = start()
    e.copyWindows([row(0, 'a', 'A'), { ...row(null, 'n', 'N'), isNew: true }])
    expect(e.windowClip).toEqual([win('a', 'A'), win('n', 'N')])
    e.begin({ ...skeleton, name: 'OTHER', edited: { ...skeleton.edited, source: { ...skeleton.edited.source, name: 'OTHER' } } }, s.me)
    expect(e.windowClip).toEqual([win('a', 'A'), win('n', 'N')])
    e.copyWindows([])
    expect(e.windowClip).toEqual([win('a', 'A'), win('n', 'N')]) // 빈 묶음으로 덮지 않는다
  })
})

describe('unsavedChanges — 창 조건', () => {
  const edited = (windows) => ({ source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F' }, headCrtime: 1, header: { description: 'd', timeoutLimit: '1', ...(windows ? { windows } : {}) }, steps: [], property: {} })
  it('대상 창·숨길 창이 바뀌면 줄 하나씩(같은 출처면 고침·더함·지움을 가른다)', () => {
    const base = edited(WINDOWS)
    const now = edited({ target: win('EQ Main', 'Main'), hiding: [row(0, 'a', 'A2'), row(null, 'n', 'N')] })
    expect(unsavedChanges(now, base)).toEqual([
      { kind: 'field', key: 'targetWindow', before: WINDOWS.target, after: now.header.windows.target },
      { kind: 'field', key: 'hidingWindows', added: [row(null, 'n', 'N')], removed: [row(1, 'b', 'B')], changed: [{ before: row(0, 'a', 'A'), after: row(0, 'a', 'A2') }] }
    ])
    expect(unsavedChanges(edited(JSON.parse(JSON.stringify(WINDOWS))), base)).toEqual([])
  })
  it('출처가 다르면(되돌려 연 세션) 내용으로만 견준다', () => {
    const base = edited(WINDOWS)
    const now = { ...edited({ target: WINDOWS.target, hiding: [row(0, 'b', 'B')] }), source: { process: 'P', model: 'M', name: 'N', crtime: 0, fileId: 'OLD' } }
    expect(unsavedChanges(now, base)).toEqual([{ kind: 'field', key: 'hidingWindows', added: [], removed: [row(0, 'a', 'A')], changed: [] }])
  })
  it('어느 한쪽에 창 조건이 없으면(이 기능 전의 초안) 줄이 없다', () => {
    expect(unsavedChanges(edited(), edited(WINDOWS))).toEqual([])
    expect(unsavedChanges(edited(WINDOWS), edited())).toEqual([])
  })
})

describe('세션 — 창 조건을 채운다', () => {
  const me = { canWrite: true }
  const sourceSk = () => {
    const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 5, fileId: 'F5' }, headCrtime: 5, header: { description: 'd', timeoutLimit: '1', windows: WINDOWS }, steps: [], property: {} }
    return { process: 'P', model: 'M', name: 'N', headCrtime: 5, propertyRev: 'r', version: { crtime: 5, isCurrent: true, fileId: 'F5' }, header: {}, notes: [], steps: [], edited }
  }
  const draft = (scenario, over = {}) => ({ draftId: 'd1', savedAt: 'x', base: scenario.source ? { crtime: 5, fileId: 'F5' } : null, headCrtime: scenario.headCrtime, propertyRev: 'r', target: { model: 'M', name: 'N' }, scenario, imageUrls: {}, process: 'P', model: 'M', name: 'N', ...over })

  it('새 시나리오는 빈 창 조건으로 시작한다', () => {
    const { working } = newScenarioOf({ process: 'P', model: 'M', name: 'NEW', type: 1, description: 'd' })
    expect(working.header.windows).toEqual(blankWindows())
  })
  it('이 기능 전에 저장한 초안(windows 없음): 기준 판이 있으면 기준 판 값으로, 새 시나리오 초안이면 빈 값으로 채운다', () => {
    const sk = sourceSk()
    const old = { ...sk.edited, header: { description: '초안 제목', timeoutLimit: '9' } }
    const a = draftSessionOf(draft(old), sk, me)
    expect(a.session.working.header).toEqual({ description: '초안 제목', timeoutLimit: '9', windows: WINDOWS })
    expect(unsavedChanges(a.session.working, a.session.saveBase).map((c) => c.key)).toEqual(['description', 'timeoutLimit'])
    const fresh = { source: null, headCrtime: null, header: { description: 'd', timeoutLimit: '240' }, steps: [], property: { Type: 1 } }
    const b = draftSessionOf(draft(fresh, { name: 'NEW' }), null, me)
    expect(b.session.working.header.windows).toEqual(blankWindows())
  })
  it('창 조건이 든 초안은 초안 값 그대로다', () => {
    const sk = sourceSk()
    const mine = { target: win('', ''), hiding: [row(null, 'x', 'X')] }
    const a = draftSessionOf(draft({ ...sk.edited, header: { ...sk.edited.header, windows: mine } }), sk, me)
    expect(a.session.working.header.windows).toEqual(mine)
  })
  it('원본이 지워져 기준 판을 모르는 옛 초안은 창 조건이 없는 채로 둔다(서버가 저장값을 그대로 쓴다)', () => {
    const sk = sourceSk()
    const a = draftSessionOf(draft({ ...sk.edited, header: { description: 'd', timeoutLimit: '1' } }), null, me)
    expect('windows' in a.session.working.header).toBe(false)
  })
  it('되돌려 연 세션: 작업본은 옛 판의 창 조건, 저장 기준점은 현재 판 — 저장 전 변경에 잡힌다', () => {
    const cur = sourceSk()
    const oldEdited = { ...cur.edited, source: { ...cur.edited.source, crtime: 1, fileId: 'F1' }, header: { ...cur.edited.header, windows: { target: win('OLD', 'Main'), hiding: [] } } }
    const oldSk = { ...cur, version: { crtime: 1, isCurrent: false, fileId: 'F1' }, edited: oldEdited }
    const r = restoreSessionOf(oldSk, cur, me)
    expect(r.session.working.header.windows.target).toEqual(win('OLD', 'Main'))
    expect(unsavedChanges(r.session.working, r.session.saveBase).map((c) => c.key)).toEqual(['targetWindow', 'hidingWindows'])
  })
})

describe('저장 창·문구', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('창 조건 검사 줄을 누르면 전처리 설정 창으로 간다(어느 조건인지 함께)', () => {
    for (const code of ['HIDING_CLASS_EMPTY', 'WINDOW_TEXT_SPACE', 'TARGET_TEXT_SPACE', 'HIDING_LIMIT', 'TARGET_WINDOW_NOT_FOUND', 'HIDING_NOT_FOUND', 'HIDING_TEXT_SPACE', 'HIDING_DUPLICATE']) {
      expect(issueGoal({ code, params: { which: 'hiding:2', no: 3 } }), code).toEqual({ kind: 'windows', which: 'hiding:2' })
    }
    expect(issueGoal({ code: 'TARGET_TEXT_SPACE', params: { which: 'target' } })).toEqual({ kind: 'windows', which: 'target' })
    expect(issueGoal({ code: 'HIDING_LIMIT', params: { count: 21, limit: 20, grew: true } })).toEqual({ kind: 'windows', which: null })
  })
  it('검사 문구가 줄 번호·이유를 담는다', () => {
    expect(t('RULE_HIDING_CLASS_EMPTY', { no: 3 })).toContain('3번')
    expect(t('RULE_HIDING_LIMIT', { count: 21, limit: 20 })).toContain('20')
    expect(t('RULE_HIDING_DUPLICATE', { no: 3, firstNo: 1 })).toMatch(/3번.*1번/)
    expect(MESSAGES.RULE_TARGET_TEXT_SPACE).toBeTruthy()
    expect(t('RULE_WINDOW_TEXT_SPACE', { no: 2 })).toContain('2번')
    for (const r of ['TEXT_EMPTY', 'TEXT_STAR', 'CLASS_EMPTY']) expect(MESSAGES[`SEW_UI_TW_REASON_${r}`]).toBeTruthy()
  })
  it('열 때 알림 문구가 줄 수를 담는다', () => {
    for (const code of ['HIDING_WINDOW_NOT_FOUND', 'HIDING_WINDOW_SPACE', 'HIDING_WINDOW_FIXED_SIZE']) {
      expect(noteMessage({ code, params: { count: 2 } }), code).toContain('2')
      expect(noteMessage({ code, params: { count: 2 } })).not.toMatch(/^\[/)
    }
  })
  it('editorStore: 안내 링크는 처음 한 번 읽어 둔다(없으면 null)', async () => {
    const s = useEditorStore()
    expect(s.links).toEqual({ preprocessingSop: null })
  })
})
