import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ check: vi.fn(), saveDraft: vi.fn(), deploy: vi.fn(), verifyDeploy: vi.fn(), finishDeploy: vi.fn(), open: vi.fn(), nameRule: vi.fn(), list: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioBar from '../components/ScenarioBar.vue'
import EditDialogs from '../components/EditDialogs.vue'
import { useSaveFlow } from '../stores/saveFlow'
import { t, MESSAGES } from '../messages'
import { panelFixture, imageStep, noneStep } from './panelFixture'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { defaultProperty } from '../editor/newScenario'
import { propertyDiffs } from '../editor/propertyView'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } }, request: {} })
const clean = (over = {}) => ({ blocks: [], warns: [], target: { exists: true, eqpCount: 3 }, conflict: null, targetExists: null, ...over })
const find = (w, id) => w.find(`[data-testid="${id}"]`)
const inDoc = (sel) => document.querySelector(sel)

function setup(check = clean(), { nameRule = { exists: false, rules: [] }, canWrite = true, realTeleport = false } = {}) {
  const f = panelFixture([imageStep(0), noneStep(1), noneStep(2)], { canWrite })
  f.s.skeleton = { ...f.s.skeleton, id: 'P-M-N', header: { description: '메일 제목', timeoutLimit: '1', targetWindow: null }, property: null, performance: null }
  f.s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }, { model: 'M2', eqpCount: 5 }] }] }
  api.check.mockImplementation(() => ok(check))
  api.nameRule.mockReturnValue(ok(nameRule))
  api.list.mockReturnValue(ok([]))
  // realTeleport: 시험 기본값(Teleport 대역)은 창을 가운데로 옮겨 다시 그릴 때 안쪽을 새로 만든다 — 창 안 초점 시험은 실제 Teleport 로 문서에서 찾는다
  const bar = mount(ScenarioBar, { attachTo: document.body, ...(realTeleport ? { global: { stubs: { teleport: false } } } : {}) })
  return { ...f, bar, flow: useSaveFlow() }
}
async function openSave(bar) {
  await find(bar, 'se-save').trigger('click')
  await flushPromises()
}

describe('저장 창(SaveDialog)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    sessionStorage.clear()
  })

  it('[저장] 은 쓸 수 있는 세션에만 보이고, 누르면 저장 창이 열려 검사를 한 번 부른다', async () => {
    const { bar } = setup()
    await openSave(bar)
    expect(find(bar, 'se-save-dialog').exists()).toBe(true)
    expect(api.check).toHaveBeenCalledTimes(1)
    expect(find(bar, 'se-save-dialog').text()).toContain(t('SEW_SAVE_CHECKS_OK'))
    bar.unmount()
    setActivePinia(createPinia())
    const ro = setup(clean(), { canWrite: false })
    expect(find(ro.bar, 'se-save').exists()).toBe(false)
    ro.bar.unmount()
  })

  it('패널에 적용 안 한 변경이 있으면 저장 창 전에 확인 창(조작판 22) — [버리고 저장 창 열기] 뒤 열린다', async () => {
    const { bar, e } = setup()
    const dlg = mount(EditDialogs, { attachTo: document.body })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '고치는 중' }))
    await find(bar, 'se-save').trigger('click')
    await flushPromises()
    expect(find(dlg, 'se-guard').text()).toContain(t('SEW_EDIT_GUARD_BODY_SAVE', { n: 1 }))
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(find(dlg, 'se-guard-drop').text()).toBe(t('SEW_EDIT_GUARD_DROP_SAVE'))
    await find(dlg, 'se-guard-drop').trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-dialog').exists()).toBe(true)
    dlg.unmount(); bar.unmount()
  })

  it('막힌 줄을 누르면 창이 닫히고 그 스텝이 선택된다', async () => {
    const { bar, s, e } = setup(clean({ blocks: [{ code: 'NEXT_UNRESOLVED', uid: 's2', params: { which: 'onTrue' } }] }))
    e.editCell('s0', 'accept', 0.8) // 바뀐 것이 있어야 초안을 저장할 수 있다
    await openSave(bar)
    const row = find(bar, 'se-save-issue')
    expect(row.text()).toContain(t('RULE_NEXT_UNRESOLVED'))
    expect(row.text()).toContain('3번')
    expect(find(bar, 'se-save-deploy').attributes('disabled')).toBeDefined()
    expect(find(bar, 'se-save-draft').attributes('disabled')).toBeUndefined()
    await row.trigger('click')
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(s.selectedUid).toBe('s2')
    expect(e.selection.uids).toEqual(['s2'])
    bar.unmount()
  })

  it('바뀐 곳(스텝)을 누르면 그 스텝으로 간다', async () => {
    const { bar, s, e } = setup()
    e.editCell('s1', 'skip', true)
    await openSave(bar)
    const rows = bar.findAll('[data-testid="se-save-change"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('2번')
    await rows[0].trigger('click')
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(s.selectedUid).toBe('s1')
    bar.unmount()
  })

  it('메일 제목 막힘을 누르면 창이 닫히고 바의 메일 제목 칸에 초점, 다시 열면 입력한 이름이 남아 있다(조작판 39)', async () => {
    const { bar, flow } = setup(clean({ blocks: [{ code: 'MAIL_TITLE_COLON' }] }))
    await openSave(bar)
    flow.setTarget({ name: 'TYPED_NAME' })
    await bar.vm.$nextTick()
    const row = find(bar, 'se-save-issue')
    expect(row.text()).toContain(t('SEW_SAVE_ISSUE_BAR'))
    await row.trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(find(bar, 'se-bar-description').element)
    await openSave(bar)
    expect(find(bar, 'se-save-name').element.value).toBe('TYPED_NAME')
    bar.unmount()
  })

  it('운영 속성 막힘을 누르면 저장 창을 닫고 운영 속성 창을 수정으로 열어 그 칸에 초점(저장된 빈 후속 = 잇기 단추)', async () => {
    const { bar, s, e } = setup(clean({ blocks: [{ code: 'FOLLOW_NAME_REQUIRED', params: { which: 'success' } }] }), { realTeleport: true })
    // 지워진 시나리오 다시 만들기: 서버는 기준이 없어 저장된 빈 후속 {Name:''} 도 바뀐 것으로 본다(Task 2a 판단)
    const property = { StartDelay: 0, RetryCnt: 0, RetryInterval: 10, Priority: 10, ExecutingLevel: 0, Type: 1, IsEnabled: true, NextScenarioIfSuccess: { Name: '', Text: '' }, NextScenarioIfFail: null, Owners: [] }
    s.skeleton = { ...s.skeleton, property }
    e.session = { ...e.session, working: { ...e.session.working, property }, saveBase: { ...e.session.saveBase, property } }
    await openSave(bar)
    const row = inDoc('[data-testid="se-save-issue"]')
    expect(row.textContent).toContain(t('RULE_FOLLOW_NAME_REQUIRED'))
    row.click()
    await flushPromises()
    expect(inDoc('[data-testid="se-save-dialog"]')).toBeNull()
    expect(inDoc('[data-testid="se-property-dialog"]')).not.toBeNull()
    expect(inDoc('[data-testid="se-prop-editing"]')).not.toBeNull()
    expect(document.activeElement).toBe(inDoc('[data-pfield="NextScenarioIfSuccess"]'))
    bar.unmount()
  })

  it('운영 속성 범위 막힘(START_DELAY_RANGE)은 그 입력칸에 초점', async () => {
    const { bar, s, e } = setup(clean({ blocks: [{ code: 'START_DELAY_RANGE' }] }), { realTeleport: true })
    const property = { StartDelay: 5, RetryCnt: 0, RetryInterval: 10, Priority: 10, ExecutingLevel: 0, Type: 1, IsEnabled: true, NextScenarioIfSuccess: null, NextScenarioIfFail: null, Owners: [] }
    s.skeleton = { ...s.skeleton, property }
    e.session = { ...e.session, working: { ...e.session.working, property } }
    await openSave(bar)
    inDoc('[data-testid="se-save-issue"]').click()
    await flushPromises()
    expect(document.activeElement).toBe(inDoc('[data-pfield="StartDelay"]'))
    expect(inDoc('[data-testid="se-prop-err-StartDelay"]').textContent).toBe(t('RULE_START_DELAY_RANGE'))
    bar.unmount()
  })

  it('이미 있는 이름이면 덮어쓰기 확인 칸과 바뀌는 운영 속성 — 빈 후속과 "없음" 은 차이 줄이 아니다', async () => {
    const diff = [{ key: 'IsEnabled', from: false, to: true }, { key: 'NextScenarioIfSuccess', from: { Name: '', Text: '' }, to: null }]
    const { bar } = setup(clean({ targetExists: { diff } }))
    await openSave(bar)
    expect(find(bar, 'se-save-deploy').attributes('disabled')).toBeDefined()
    const rows = bar.findAll('[data-testid="se-save-diff"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('꺼짐')
    expect(rows[0].text()).toContain('켜짐')
    await find(bar, 'se-save-overwrite').setValue(true)
    expect(find(bar, 'se-save-deploy').attributes('disabled')).toBeUndefined()
    bar.unmount()
  })

  it('삭제 충돌에 캐시마저 없으면 다시 만들 수 없다고 알리고 초안만 켠다', async () => {
    const gone = clean({ blocks: [{ code: 'SOURCE_GONE' }], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 3 } })
    const { bar, e } = setup(gone)
    e.editCell('s0', 'accept', 0.8)
    await openSave(bar)
    const box = find(bar, 'se-save-conflict')
    expect(box.text()).toContain(t('SEW_SAVE_CONFLICT_DELETED'))
    expect(bar.findAll('[data-testid="se-save-issue"]')).toHaveLength(0)
    await find(bar, 'se-save-force').setValue(true)
    await flushPromises()
    expect(find(bar, 'se-save-conflict').text()).toContain(t('SEW_SAVE_RECREATE_NO_CACHE'))
    expect(find(bar, 'se-save-deploy').attributes('disabled')).toBeDefined()
    expect(find(bar, 'se-save-draft').attributes('disabled')).toBeUndefined()
    bar.unmount()
  })

  it('[설비에 배포…] → 확인(대상·설비 수) → 배포 중에는 닫기 단추가 없고 바깥을 눌러도 닫히지 않는다', async () => {
    const { bar, flow } = setup()
    await openSave(bar)
    await find(bar, 'se-save-deploy').trigger('click')
    expect(find(bar, 'se-save-confirm').text()).toContain('P-M-N')
    expect(find(bar, 'se-save-confirm').text()).toContain(t('SEW_SAVE_CONFIRM_SAME', { id: 'P-M-N', model: 'M', n: 3 }))
    let release
    api.deploy.mockReturnValueOnce(new Promise((res) => { release = res }))
    await find(bar, 'se-save-go').trigger('click')
    expect(find(bar, 'se-save-run').exists()).toBe(true)
    expect(find(bar, 'se-save-dialog').find('[aria-label="닫기"]').exists()).toBe(false)
    await find(bar, 'se-save-dialog').find('.bg-black\\/40').trigger('click')
    expect(flow.stage).toBe('run')
    api.open.mockReturnValue(ok({ process: 'P', model: 'M', name: 'N', id: 'P-M-N', headCrtime: 9, version: { crtime: 9, isCurrent: true, fileId: 'F9' }, notes: [], steps: [], header: { description: '', timeoutLimit: '1' }, edited: { source: { process: 'P', model: 'M', name: 'N', crtime: 9, fileId: 'F9' }, headCrtime: 9, header: { description: '', timeoutLimit: '1' }, steps: [], property: {} } }))
    release({ data: { data: { result: 'ok', crtime: 9, partialFailed: [] } } })
    await flushPromises()
    expect(find(bar, 'se-save-result').text()).toContain(t('SEW_SAVE_OK_TITLE'))
    bar.unmount()
  })

  it('배포 중에는 브라우저 떠나기(새로고침·창 닫기)를 묻고, 결과가 나오면 풀린다', async () => {
    const { bar } = setup()
    await openSave(bar)
    await find(bar, 'se-save-deploy').trigger('click')
    let reject
    api.deploy.mockReturnValueOnce(new Promise((res, rej) => { reject = rej }))
    await find(bar, 'se-save-go').trigger('click')
    const leave = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented }
    expect(leave()).toBe(true)
    reject({ response: { status: 503, data: { code: 'UPSTREAM_DOWN' } }, request: {} })
    await flushPromises()
    expect(find(bar, 'se-save-result').exists()).toBe(true)
    expect(leave()).toBe(false)
    bar.unmount()
  })

  it('503 실패 화면: 아무것도 바뀌지 않았다고 알리고 "잠시 뒤" 라는 말이 없다 — [다시 배포]·[초안 저장]', async () => {
    const { bar } = setup()
    await openSave(bar)
    await find(bar, 'se-save-deploy').trigger('click')
    api.deploy.mockImplementationOnce(() => fail(503, 'UPSTREAM_DOWN'))
    await find(bar, 'se-save-go').trigger('click')
    await flushPromises()
    const r = find(bar, 'se-save-result')
    expect(r.text()).toContain(t('SEW_SAVE_FAIL_TITLE'))
    expect(r.text()).toContain(t('SEW_SAVE_CAUSE_UPSTREAM_DOWN'))
    expect(r.text()).not.toContain('잠시 뒤')
    expect(find(bar, 'se-save-redeploy').exists()).toBe(true)
    expect(find(bar, 'se-save-result-draft').exists()).toBe(true)
    bar.unmount()
  })

  it('결과 모름 화면 — [버전 목록 확인] 으로 확인하고, 없으면 [다시 확인]·[다시 배포]', async () => {
    const { bar } = setup()
    await openSave(bar)
    await find(bar, 'se-save-deploy').trigger('click')
    api.deploy.mockImplementationOnce((fd) => fail(504, 'UPSTREAM_TIMEOUT', { requestId: JSON.parse(fd.get('meta')).requestId }))
    await find(bar, 'se-save-go').trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-result').text()).toContain(t('SEW_SAVE_UNKNOWN_TITLE'))
    expect(find(bar, 'se-save-redeploy').exists()).toBe(false)
    api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
    await find(bar, 'se-save-verify').trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-result').text()).toContain(t('SEW_SAVE_VERIFY_NONE'))
    expect(find(bar, 'se-save-verify').text()).toBe(t('SEW_SAVE_VERIFY_AGAIN'))
    expect(find(bar, 'se-save-redeploy').exists()).toBe(true)
    bar.unmount()
  })

  it('새로고침 뒤 다른 시나리오에서 되살린 결과 모름 — 그곳으로 다시 보내지 않는다고 알리고, [다시 배포]는 지금 시나리오의 저장 창(알림 줄)', async () => {
    sessionStorage.setItem('se-save-pending', JSON.stringify({ requestId: '11111111-2222-4333-8444-555555555555', target: { process: 'P', model: 'M', name: 'NEW_ONE' }, at: 1 }))
    const { bar } = setup()
    await openSave(bar)
    expect(find(bar, 'se-save-unknown-restored').text()).toBe(t('SEW_SAVE_UNKNOWN_RESTORED_OTHER', { id: 'P-M-NEW_ONE' }))
    api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
    await find(bar, 'se-save-verify').trigger('click')
    await flushPromises()
    await find(bar, 'se-save-redeploy').trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-notice').text()).toBe(t('SEW_SAVE_REDEPLOY_OWN_TARGET', { from: 'P-M-NEW_ONE', to: 'P-M-N' }))
    expect(api.check.mock.calls.at(-1)[0].target).toEqual({ process: 'P', model: 'M', name: 'N' })
    bar.unmount()
  })

  it('초안을 저장하면 결과 화면과 바에 초안 시각', async () => {
    const { bar, e } = setup()
    e.editCell('s1', 'skip', true)
    await openSave(bar)
    api.saveDraft.mockReturnValue(ok({ draftId: 'd1', savedAt: new Date(2026, 10, 9, 14, 23).toISOString(), revision: 1 }))
    await find(bar, 'se-save-draft').trigger('click')
    await flushPromises()
    expect(find(bar, 'se-save-result').text()).toContain(t('SEW_SAVE_DRAFT_TITLE'))
    expect(find(bar, 'se-bar-draft').text()).toContain('14:23')
    bar.unmount()
  })

  it('이름 만들기: 규칙이 있으면 칸을 나눠 만들고 [이 이름 쓰기] 로 이름 칸에 넣는다(3번 칸 5자 미만이면 못 씀)', async () => {
    const nameRule = { exists: true, rules: [{ groupLevel: 1, name: 'ALARM', description: '알람' }, { groupLevel: 2, name: 'RESET', description: '해제' }] }
    const { bar, flow } = setup(clean(), { nameRule })
    await openSave(bar)
    await find(bar, 'se-save-name-make').trigger('click')
    await find(bar, 'se-save-name-major').setValue('ALARM')
    await find(bar, 'se-save-name-middle').setValue('RESET')
    await find(bar, 'se-save-name-part3').setValue('E12')
    expect(find(bar, 'se-save-name-use').attributes('disabled')).toBeDefined()
    expect(find(bar, 'se-save-name-panel').text()).toContain(t('SEW_NAME_PART_SHORT', { min: 5, n: 3 }))
    await find(bar, 'se-save-name-part3').setValue('E1234')
    expect(find(bar, 'se-save-name-panel').text()).toContain('ALARM_RESET_E1234')
    await find(bar, 'se-save-name-use').trigger('click')
    expect(flow.target.name).toBe('ALARM_RESET_E1234')
    expect(find(bar, 'se-save-name-panel').exists()).toBe(false)
    bar.unmount()
  })

  it('이름 규칙이 없으면 [이름 만들기] 가 없고 직접 입력만 — 칸 오류는 바로 보인다', async () => {
    const { bar } = setup()
    await openSave(bar)
    expect(find(bar, 'se-save-name-make').exists()).toBe(false)
    await find(bar, 'se-save-name').setValue('BAD-NAME')
    expect(find(bar, 'se-save-dialog').text()).toContain(MESSAGES.RULE_NAME_CHARS)
    expect(find(bar, 'se-save-deploy').attributes('disabled')).toBeDefined()
    bar.unmount()
  })
  it('새 시나리오 창으로 만든 세션(beginNew)에서 저장 창을 열면 "새 시나리오 첫 저장"(조작판 28) — 대상은 만든 공정·모델·이름, 출처·운영 속성 지문 없음', async () => {
    const s = useEditorStore()
    s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }
    s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }, { model: 'M2', eqpCount: 5 }] }] }
    useEditStore().beginNew({ process: 'P', model: 'M2', name: 'NEW_ONE', type: 1, description: '새 메일', timeoutLimit: '240' })
    api.check.mockImplementation(() => ok(clean({ target: { exists: false, eqpCount: 5 } })))
    api.nameRule.mockReturnValue(ok({ exists: false, rules: [] }))
    api.list.mockReturnValue(ok([]))
    const bar = mount(ScenarioBar, { attachTo: document.body })
    await openSave(bar)
    const dlg = find(bar, 'se-save-dialog')
    expect(dlg.find('.se-sv-sub').text()).toContain('P-M2-NEW_ONE')
    expect(dlg.find('.se-sv-tag').text()).toBe(t('SEW_SAVE_TAG_FIRST'))
    expect(find(bar, 'se-save-model').element.value).toBe('M2')
    expect(find(bar, 'se-save-name').element.value).toBe('NEW_ONE')
    expect(dlg.text()).toContain(t('SEW_SAVE_TARGET_NEW'))
    const meta = api.check.mock.calls[0][0]
    expect(meta.target).toEqual({ process: 'P', model: 'M2', name: 'NEW_ONE' })
    expect(meta.propertyRev).toBe(null)
    expect(meta.force).toBe(false)
    expect(meta.scenario).toEqual({ source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '240' }, steps: [], property: defaultProperty({ id: 'P-M2-NEW_ONE', type: 1 }) })
    bar.unmount()
  })
  it('바뀐 것의 운영 속성 줄은 칸 이름과 이전 → 지금 값을 보인다(목업 svChanges "재시도 횟수 1 → 2") — 새 시나리오를 꺼짐으로 바꾸면 "상태 켜짐 → 꺼짐"', async () => {
    const s = useEditorStore()
    s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }
    s.scopes = { processes: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }] }] }
    const e = useEditStore()
    e.beginNew({ process: 'P', model: 'M', name: 'NEW_ONE', type: 1, description: '새 메일', timeoutLimit: '240' })
    const made = e.session.working.property
    expect(made.IsEnabled).toBe(true)
    expect(e.applyProperty({ ...made, IsEnabled: false, RetryCnt: made.RetryCnt + 1 })).toBe(true)
    api.check.mockImplementation(() => ok(clean({ target: { exists: false, eqpCount: 3 } })))
    api.nameRule.mockReturnValue(ok({ exists: false, rules: [] }))
    api.list.mockReturnValue(ok([]))
    const bar = mount(ScenarioBar, { attachTo: document.body })
    await openSave(bar)
    const rows = bar.findAll('[data-testid="se-save-change"]')
    expect(rows).toHaveLength(1)
    const text = rows[0].text()
    expect(text).toContain(t('SEW_SAVE_CHANGE_PROPERTY'))
    expect(text).toContain('상태 켜짐 → 꺼짐')
    expect(text).toContain(`재시도 ${propertyDiffs(made, e.session.working.property).find((d) => d.key === 'RetryCnt').from} → `)
    expect(text).not.toMatch(/켜짐\s*,|^운영 속성\s*켜짐$/) // 칸 이름만 늘어놓지 않는다
    bar.unmount()
  })
  it('덮어쓰기 차이 — 대상의 지금 값을 모르면(null) "null"·빈 글이 아니라 "?", 표에 없는 유형은 "저장 값 N"', async () => {
    const diff = [{ key: 'IsEnabled', from: null, to: true }, { key: 'Type', from: null, to: 99 }, { key: 'StartDelay', from: null, to: 0 }, { key: 'NextScenarioIfFail', from: null, to: { Name: 'A', Text: '' } }]
    const { bar } = setup(clean({ targetExists: { diff } }))
    await openSave(bar)
    expect(bar.findAll('[data-testid="se-save-diff"]').map((r) => r.text())).toEqual(['상태: ? → 켜짐', '유형: ? → 저장 값 99', '시작 지연: ? → 0초', '실패하면 후속: 없음 → A'])
    bar.unmount()
  })
  it('덮어쓰기 차이의 켜짐·꺼짐 줄 이름은 값처럼 읽히지 않게 "상태" 다', async () => {
    const { bar } = setup(clean({ targetExists: { diff: [{ key: 'IsEnabled', from: true, to: false }] } }))
    await openSave(bar)
    expect(bar.findAll('[data-testid="se-save-diff"]')[0].text()).toBe('상태: 켜짐 → 꺼짐')
    bar.unmount()
  })
})
