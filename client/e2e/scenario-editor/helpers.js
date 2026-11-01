import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
export const expected = (set, name) => JSON.parse(readFileSync(join(ROOT, 'tools/scenario-gen/out', set, name, 'expected.json'), 'utf8'))

export async function asUser(page, singleid) {
  await page.addInitScript((u) => { localStorage.setItem('se-dev-user', u); localStorage.setItem('se-hint-base-image', '1') }, singleid)
}

export async function openFromDialog(page, process, model, name) {
  await page.getByTestId('se-load').click()
  await page.getByTestId('se-load-process').selectOption(process)
  await page.getByTestId('se-load-model').selectOption(model)
  await page.getByTestId('se-load-search').fill(name)
  await page.getByTestId('se-load-dialog').getByRole('gridcell', { name, exact: true }).dblclick()
  await page.getByTestId('se-bar-id').filter({ hasText: `${process}-${model}-${name}` }).waitFor()
}
