// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { parseShapeModel } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import { RELATIVE_TETRAHEDRON_OBJ, scaledTetrahedronObj } from '../helpers/objFixture'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtureRoot = join(projectRoot, 'node_modules', '.tmp')
const sentinel = Buffer.from('existing shape must survive invalid input')
let directory: string
const outputPath = (tier: string): string => join(directory, 'out', 'asteroids', 'shapes', `mesh_${tier}.bin`)

beforeAll(async () => {
  await mkdir(fixtureRoot, { recursive: true })
  directory = await mkdtemp(join(fixtureRoot, 'shape-cli-'))
  await build({
    configFile: false, logLevel: 'silent', publicDir: false,
    resolve: { alias: { '@': join(projectRoot, 'src') } },
    build: {
      ssr: join(projectRoot, 'scripts/build-shape-models.ts'), target: 'es2022',
      outDir: directory, emptyOutDir: false, minify: false,
      rollupOptions: { output: { entryFileNames: 'build-shape-models.mjs' } }
    }
  })
  await mkdir(join(directory, 'src'))
  await mkdir(dirname(outputPath('l0')), { recursive: true })
})

beforeEach(async () => {
  for (const tier of ['l0', 'near']) await writeFile(outputPath(tier), sentinel)
})

afterAll(async () => {
  if (!directory) return
  const target = resolve(directory)
  if (dirname(target) !== resolve(fixtureRoot) || !target.startsWith(join(resolve(fixtureRoot), 'shape-cli-'))) {
    throw new Error(`Refusing to remove an unexpected fixture directory: ${target}`)
  }
  await rm(target, { recursive: true, force: true })
})

function run(): Promise<{ status: number; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    execFile(process.execPath, [join(directory, 'build-shape-models.mjs'), '--src', join(directory, 'src'), '--out', join(directory, 'out')],
      { cwd: projectRoot, encoding: 'utf8', timeout: 30000, windowsHide: true }, (error, _stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error)
        resolveResult({ status: error ? Number(error.code) : 0, stderr })
      })
  })
}

it('writes finite shape assets for an OBJ with relative indices', { timeout: 40000 }, async () => {
  await writeFile(join(directory, 'src', 'mesh.obj'), RELATIVE_TETRAHEDRON_OBJ)

  const result = await run()

  expect(result.status, result.stderr).toBe(0)
  for (const tier of ['l0', 'near']) {
    const bytes = await readFile(outputPath(tier))
    const data = parseShapeModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect([data.positions.length / 3, data.indices.length / 3]).toEqual([4, 4])
    expect(data.positions.every(Number.isFinite)).toBe(true)
    expect(data.normals.every(Number.isFinite)).toBe(true)
  }
})

it('rejects invalid OBJ references without overwriting either existing asset', { timeout: 40000 }, async () => {
  await writeFile(join(directory, 'src', 'mesh.obj'), 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf -4 2 3')

  const result = await run()

  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(/OBJ.*(index|vertex)/i)
  for (const tier of ['l0', 'near']) expect(await readFile(outputPath(tier))).toEqual(sentinel)
})

it('normalizes large finite coordinates before writing both shape tiers', { timeout: 40000 }, async () => {
  await writeFile(join(directory, 'src', 'mesh.obj'), scaledTetrahedronObj(1e40))

  const result = await run()

  expect(result.status, result.stderr).toBe(0)
  for (const tier of ['l0', 'near']) {
    const bytes = await readFile(outputPath(tier))
    const data = parseShapeModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect([data.positions.length / 3, data.indices.length / 3]).toEqual([4, 4])
    for (const coordinate of data.positions) expect(Math.abs(coordinate)).toBeCloseTo(1 / Math.sqrt(3), 6)
    for (let i = 0; i < data.normals.length; i += 3) {
      expect(Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2])).toBeCloseTo(1, 6)
    }
  }
})

it('rejects arithmetic overflow without overwriting either existing asset', { timeout: 40000 }, async () => {
  await writeFile(join(directory, 'src', 'mesh.obj'), scaledTetrahedronObj(1e200))

  const result = await run()

  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(/normalize.*non-finite/i)
  for (const tier of ['l0', 'near']) expect(await readFile(outputPath(tier))).toEqual(sentinel)
})
