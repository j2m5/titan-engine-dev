import process from 'node:process'
import sharp from 'sharp'
import { argument } from './lib/cliArguments'

/**
 * Сборка детального набора архетипа `ice` (terrain/ice_{diff,nor,arm}.webp):
 * снежное поле как основа + плиты и трещины льда в один тайл.
 *
 * Входы (наборы владельца, вне git): `--snow <dir>` — Poly Haven
 * `snow_field_aerial_2k/textures` (col/nor_gl/arm), `--ice <dir>` — ambientCG
 * `Ice004_2K-JPG` (Color/Displacement/Roughness). Оба 2048², бесшовные.
 *
 * Состав:
 * - diff = снег × плиты (яркость льда без НЧ-подложки σ=120 px — иначе
 *   градиент яркости тайла даёт банды при тайлинге; нормировка к среднему,
 *   модуляция на `--color-mix`);
 * - nor  = whiteout-бленд снежной нормали и нормали плит из Displacement
 *   (центральная разность с заворотом по краям, наклон `--disp-strength`; GL:
 *   +Y — верх картинки);
 * - arm  = R: AO снега × яркость плит (трещины темнее), G: roughness снега,
 *   смешанный к льду на `--rough-mix`, B: 0.
 *
 * Дефолты — приёмка владельца 2026-08-30 (Энцелад/Плутон: «теперь видно»).
 *
 * Запуск: npm run build:ice-archetype -- --snow tmpscreenshots/snow_field_aerial_2k/textures
 *   --ice tmpscreenshots/Ice004_2K-JPG [--color-mix 0.7] [--disp-strength 6] [--rough-mix 0.4]
 *   [--out storage/images/textures/terrain]
 */

const SIZE = 2048

const snowDir = argument('snow')
const iceDir = argument('ice')
const outDir = argument('out') ?? 'storage/images/textures/terrain'
const colorMix = Number(argument('color-mix') ?? 0.7)
const dispStrength = Number(argument('disp-strength') ?? 6)
const roughMix = Number(argument('rough-mix') ?? 0.4)

if (!snowDir || !iceDir) {
  console.error('Нужны --snow <dir snow_field_aerial> и --ice <dir Ice004>')
  process.exit(1)
}
if (![colorMix, dispStrength, roughMix].every(Number.isFinite)) {
  console.error('Ручки --color-mix/--disp-strength/--rough-mix должны быть числами')
  process.exit(1)
}

async function grey(file: string, blurSigma?: number): Promise<Uint8Array> {
  let pipeline = sharp(file).greyscale().toColourspace('b-w')
  if (blurSigma) pipeline = pipeline.blur(blurSigma)
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true })
  // sharp может развернуть серый jpeg в 3 канала — индексация без шага молча читала бы мусор
  if (info.channels !== 1 || info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`${file}: ожидался 1 канал ${SIZE}², получено ${info.channels} каналов ${info.width}×${info.height}`)
  }
  return data
}

async function rgb(file: string): Promise<Uint8Array> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  if (info.channels !== 3 || info.width !== SIZE || info.height !== SIZE) {
    throw new Error(`${file}: ожидалось 3 канала ${SIZE}², получено ${info.channels} каналов ${info.width}×${info.height}`)
  }
  return data
}

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

const col = await rgb(`${snowDir}/snow_field_aerial_col_2k.jpg`)
const nor = await rgb(`${snowDir}/snow_field_aerial_nor_gl_2k.jpg`)
const arm = await rgb(`${snowDir}/snow_field_aerial_arm_2k.jpg`)
const iceLum = await grey(`${iceDir}/Ice004_2K-JPG_Color.jpg`)
const iceLow = await grey(`${iceDir}/Ice004_2K-JPG_Color.jpg`, 120)
const disp = await grey(`${iceDir}/Ice004_2K-JPG_Displacement.jpg`)
const rough = await grey(`${iceDir}/Ice004_2K-JPG_Roughness.jpg`)

let mean = 0
for (let i = 0; i < iceLum.length; i++) mean += iceLum[i]
mean /= iceLum.length

const N = SIZE
const outDiff = Buffer.alloc(N * N * 3)
const outNor = Buffer.alloc(N * N * 3)
const outArm = Buffer.alloc(N * N * 3)

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const p = y * N + x
    const plate = Math.max(0.2, (iceLum[p] - iceLow[p] + mean) / mean)
    const modulation = 1 + (plate - 1) * colorMix
    for (let k = 0; k < 3; k++) outDiff[p * 3 + k] = clampByte(col[p * 3 + k] * modulation)

    const xl = (x - 1 + N) % N
    const xr = (x + 1) % N
    const yu = (y - 1 + N) % N
    const yd = (y + 1) % N
    const dx = ((disp[y * N + xr] - disp[y * N + xl]) / 255) * dispStrength
    const dy = ((disp[yd * N + x] - disp[yu * N + x]) / 255) * dispStrength
    let ix = -dx
    let iy = dy
    let iz = 1
    let len = Math.hypot(ix, iy, iz)
    ix /= len
    iy /= len
    iz /= len

    const sx = nor[p * 3] / 127.5 - 1
    const sy = nor[p * 3 + 1] / 127.5 - 1
    const sz = nor[p * 3 + 2] / 127.5 - 1
    let nx = sx + ix
    let ny = sy + iy
    let nz = sz * iz
    len = Math.hypot(nx, ny, nz)
    nx /= len
    ny /= len
    nz /= len
    outNor[p * 3] = clampByte((nx + 1) * 127.5)
    outNor[p * 3 + 1] = clampByte((ny + 1) * 127.5)
    outNor[p * 3 + 2] = clampByte((nz + 1) * 127.5)

    outArm[p * 3] = clampByte(arm[p * 3] * (0.6 + 0.4 * Math.min(1.2, plate)))
    outArm[p * 3 + 1] = clampByte(arm[p * 3 + 1] * (1 - roughMix) + rough[p] * roughMix)
    outArm[p * 3 + 2] = 0
  }
}

const raw = { width: N, height: N, channels: 3 as const }
await sharp(outDiff, { raw }).webp({ quality: 90 }).toFile(`${outDir}/ice_diff.webp`)
await sharp(outNor, { raw }).webp({ lossless: true }).toFile(`${outDir}/ice_nor.webp`)
await sharp(outArm, { raw }).webp({ quality: 90 }).toFile(`${outDir}/ice_arm.webp`)

console.log(`записано ${outDir}/ice_{diff,nor,arm}.webp: color-mix ${colorMix}, disp-strength ${dispStrength}, rough-mix ${roughMix}`)
