import { existsSync } from 'node:fs'
import { measureDetailStats } from './lib/detailTextureStats'

const STORAGE = 'storage/images/textures/'
const SETS = ['rocky_trail', 'ice', 'sand', 'volcanic']

async function main(): Promise<void> {
  for (const set of SETS) {
    const diff = `terrain/${set}_diff.webp`
    const arm = `terrain/${set}_arm.webp`
    if (!existsSync(STORAGE + diff) || !existsSync(STORAGE + arm)) {
      console.log(`${set}: файлов нет в storage`)
      continue
    }
    const d = await measureDetailStats(STORAGE + diff)
    const a = await measureDetailStats(STORAGE + arm)
    console.log(`  '${diff}': { meanLum: ${d.meanLum.toFixed(3)} },`)
    console.log(`  '${arm}': { meanAo: ${a.meanAo.toFixed(3)} },`)
  }
}

void main()
