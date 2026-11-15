// 받기 진행 창 — "n / 전체"·[취소], 못 받은 것 목록·[닫기] (P3 설계 §4.6)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, enableAutoUnmount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

const api = vi.hoisted(() => ({ snapshotImage: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import DownloadDialog from '../components/snapshot/DownloadDialog.vue'
import { useSnapshotDownloadStore } from '../stores/snapshotDownloadStore'
import { t } from '../messages'

enableAutoUnmount(afterEach)
const body = () => new DOMWrapper(document.body)
const tid = (id) => body().find(`[data-testid="${id}"]`)
const item = (n, time) => ({ fileName: `${n}_[1][2].png`, ms: n, time, kind: 'click', x: 1, y: 2 })

describe('DownloadDialog', () => {
  let d
  beforeEach(() => {
    setActivePinia(createPinia())
    d = useSnapshotDownloadStore()
    mount(DownloadDialog, { attachTo: document.body })
  })
  afterEach(() => vi.restoreAllMocks())
  const set = async (job) => { d.job = job; await nextTick() }

  it('받지 않을 때는 창이 없다', () => {
    expect(tid('se-download-dialog').exists()).toBe(false)
  })

  it('받는 중: "n / 전체" 와 [취소] — [닫기] 는 없고 바깥을 눌러도 닫히지 않는다', async () => {
    await set({ status: 'running', done: 3, total: 12, failed: [], saved: null })
    expect(tid('se-download-progress').text()).toBe(t('SEW_SNAP_DL_PROGRESS', { done: 3, total: 12 }))
    expect(tid('se-download-bar').attributes('style')).toContain('25%')
    expect(tid('se-download-close').exists()).toBe(false)
    const cancel = vi.spyOn(d, 'cancel')
    await tid('se-download-cancel').trigger('click')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('받는 중 Esc 는 취소다', async () => {
    await set({ status: 'running', done: 0, total: 2, failed: [], saved: null })
    const cancel = vi.spyOn(d, 'cancel')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('끝났는데 못 받은 것이 있으면 받은 수와 못 받은 것(시각·이유)을 보이고 [닫기]', async () => {
    await set({ status: 'done', done: 3, total: 3, saved: { name: 'A_2026-11-11_snapshots_2.zip', count: 2 }, failed: [{ item: item(1, '09:13:02'), reason: '그림이 서버에 없습니다.' }] })
    expect(tid('se-download-summary').text()).toBe(t('SEW_SNAP_DL_PARTIAL', { n: 2, failed: 1, name: 'A_2026-11-11_snapshots_2.zip' }))
    const rows = body().findAll('[data-testid="se-download-failed"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('09:13:02')
    expect(rows[0].text()).toContain('그림이 서버에 없습니다.')
    expect(tid('se-download-cancel').exists()).toBe(false)
    await tid('se-download-close').trigger('click')
    expect(d.job.status).toBe('idle')
    await nextTick()
    expect(tid('se-download-dialog').exists()).toBe(false)
  })

  it('하나도 받지 못했으면 저장된 것이 없다고 알린다', async () => {
    await set({ status: 'done', done: 2, total: 2, saved: null, failed: [{ item: item(1, '09:00:00'), reason: 'x' }, { item: item(2, '09:00:01'), reason: 'y' }] })
    expect(tid('se-download-summary').text()).toBe(t('SEW_SNAP_DL_NONE', { failed: 2 }))
    expect(body().findAll('[data-testid="se-download-failed"]')).toHaveLength(2)
  })

  it('끝난 뒤 Esc 는 닫기다', async () => {
    await set({ status: 'done', done: 1, total: 1, saved: null, failed: [{ item: item(1, '09:00:00'), reason: 'x' }] })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(d.job.status).toBe('idle')
  })
})
