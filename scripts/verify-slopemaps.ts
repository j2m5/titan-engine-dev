import path from 'node:path'
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { RenderingObjects } from '../storage/database/renderingObjects'
import { Resources } from '../storage/database/resources'
import { ActorResource } from '../storage/database/actorResource'
import { countZeroedLandTexels } from './lib/slopeMapVerify'

const TEXTURES_ROOT = 'storage/images/textures'

type Job = { actorId: number; slopePath: string }

function slopeJobsWithWater(): Job[] {
  const jobs: Job[] = []

  for (const ro of RenderingObjects) {
    const data = ro.data as { waterLevelMeters?: unknown } | undefined
    if (typeof data?.waterLevelMeters !== 'number') continue

    const resourceIds = ActorResource.filter((link) => link.actorId === ro.actorId).map((link) => link.resourceId)
    const slope = Resources.find((r) => resourceIds.includes(r.id) && r.resourceType === 'slope')
    if (slope) jobs.push({ actorId: ro.actorId, slopePath: slope.path })
  }

  return jobs
}

let broken = 0

for (const job of slopeJobsWithWater()) {
  const file = path.join(TEXTURES_ROOT, job.slopePath)

  if (!existsSync(file)) {
    console.log(`[skip] actorId ${job.actorId}: нет файла ${file}`)
    continue
  }

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })

  // Число каналов проверяется ДО подсчёта: у тела с водой карта без альфы —
  // уже провал, а countZeroedLandTexels принимает только 3|4 (проверка
  // сужает number до 4, каста не нужно).
  if (info.channels !== 4) {
    console.error(`[FAIL] actorId ${job.actorId}: ${file} — ${info.channels} канала, у тела с водой ожидается 4 (канал A = глубина)`)
    broken++
    continue
  }

  const { land, zeroed } = countZeroedLandTexels(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.channels)

  if (zeroed > 0) {
    console.error(`[FAIL] actorId ${job.actorId}: ${file} — RGB=0 у ${zeroed} из ${land} текселей суши (карта собрана без exact: true)`)
    broken++
  } else {
    console.log(`[ok] actorId ${job.actorId}: ${file} — ${land} текселей суши, обнулённых 0`)
  }
}

if (broken > 0) {
  console.error(`СТОП: битых slope-карт ${broken}`)
  process.exit(1)
}
