import process from 'node:process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Resources } from '@storage/database/resources'
import { cloudManifestPaths } from './lib/cloudManifest'

/**
 * Печатает манифест облака (белый список синка бакета, мотив — докблок
 * `scripts/lib/cloudManifest.ts`): по одному пути на строку в stdout,
 * сводка и проблемы — в stderr.
 *
 * Запуск: npm run cloud:manifest [-- --check]
 *
 * `--check` — только сверка с диском, манифест не печатается. Файл манифеста,
 * которого нет на диске, — ошибка в обоих режимах (exit 1): либо мёртвая
 * строка БД, либо потерянный артефакт — синкать в таком состоянии нельзя.
 */

const ROOT = 'storage/images/textures'
const checkOnly = process.argv.includes('--check')

const manifest = cloudManifestPaths(Resources)
const missing: string[] = []
let totalBytes = 0

for (const relative of manifest) {
  const local = path.join(ROOT, relative)

  if (!existsSync(local)) {
    missing.push(relative)
    continue
  }
  totalBytes += statSync(local).size
  if (!checkOnly) console.log(relative)
}

console.error(`манифест: ${manifest.length} файлов, ${(totalBytes / 1048576).toFixed(0)} МиБ на диске`)

if (missing.length > 0) {
  for (const relative of missing) console.error(`[НЕТ НА ДИСКЕ] ${relative}`)
  process.exit(1)
}
