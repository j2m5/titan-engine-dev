// @vitest-environment node
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { build } from 'vite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { DEM_16BIT_PNG } from '../helpers/demPngFixture'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtureRoot = join(projectRoot, 'node_modules', '.tmp')
const sentinel = Buffer.from('existing heightmap must survive invalid arguments')
let directory: string
let input: string
let output: string
let png: string

beforeAll(async () => {
  await mkdir(fixtureRoot, { recursive: true })
  directory = await mkdtemp(join(fixtureRoot, 'heightmap-cli-'))
  // Compile the actual entry once; individual cases still run in fresh Node processes.
  // Repeated vite-node startup otherwise spends minutes optimizing unrelated app dependencies.
  await build({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    resolve: { alias: { '@': join(projectRoot, 'src') } },
    build: {
      ssr: join(projectRoot, 'scripts/build-heightmap.ts'), target: 'es2022',
      outDir: directory, emptyOutDir: false, minify: false,
      rollupOptions: { output: { entryFileNames: 'build-heightmap.mjs' } }
    }
  })
  input = join(directory, 'source.img')
  output = join(directory, 'result.raw')
  png = join(directory, 'source.png')
  const values = [-200, -100, 0, 100, 200, -200, -100, 0, 100, 200]
  const data = Buffer.alloc(values.length * 2)
  values.forEach((value, index) => data.writeInt16LE(value, index * 2))
  await writeFile(input, data)
  await sharp(Buffer.from([0, 100]), { raw: { width: 2, height: 1, channels: 1 } }).png().toFile(png)
})

beforeEach(async () => {
  await writeFile(output, sentinel)
})

afterAll(async () => {
  if (!directory) return
  const target = resolve(directory)
  if (dirname(target) !== resolve(fixtureRoot) || !target.startsWith(join(resolve(fixtureRoot), 'heightmap-cli-'))) {
    throw new Error(`Refusing to remove an unexpected fixture directory: ${target}`)
  }
  await rm(target, { recursive: true, force: true })
})

type Result = { status: number; stdout: string; stderr: string }

function run(args: string[]): Promise<Result> {
  return new Promise((resolveResult, reject) => {
    execFile(process.execPath, [join(directory, 'build-heightmap.mjs'), ...args],
    { cwd: projectRoot, encoding: 'utf8', timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error)
        return
      }
      resolveResult({ status: error ? Number(error.code) : 0, stdout, stderr })
    })
  })
}

function rawArgs(overrides: Record<string, string | undefined> = {}): string[] {
  const flags: Record<string, string | undefined> = {
    in: input, out: output, width: '3', height: '1', 'in-width': '5', 'in-height': '2', ...overrides
  }
  return Object.entries(flags).flatMap(([name, value]) => value === undefined ? [] : [`--${name}`, value])
}

async function expectRejected(args: string[], flag: string): Promise<void> {
  const result = await run(args)
  expect(result.status, result.stdout + result.stderr).toBe(1)
  expect(result.stderr).toContain(`--${flag}`)
  expect(result.stderr).toMatch(/целым.*числом/i)
  expect(await readFile(output)).toEqual(sentinel)
}

async function readOutput() {
  const bytes = await readFile(output)
  return parseHeightMap(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

describe('build:heightmap dimension validation', { timeout: 40000 }, () => {
  it.each([
    { flag: 'width', overrides: { width: '2.5' } },
    { flag: 'height', overrides: { height: '1.5' } },
    // Both fractional source grids still describe exactly 10 samples: byte-length validation cannot catch them.
    { flag: 'in-width', overrides: { 'in-width': '2.5', 'in-height': '4' } },
    { flag: 'in-height', overrides: { 'in-width': '4', 'in-height': '2.5' } }
  ])('rejects fractional --$flag without overwriting output', async ({ flag, overrides }) => {
    await expectRejected(rawArgs({ ...overrides, 'min-meters': '-200', 'max-meters': '200' }), flag)
  })

  it.each(['width', 'height', 'in-width', 'in-height'])('rejects zero --%s before file I/O', async (flag) => {
    await expectRejected(rawArgs({ [flag]: '0', in: join(directory, 'missing.img') }), flag)
  })

  it.each(['-1', 'NaN', 'Infinity', 'not-a-number', '4294967296'])('rejects invalid output width %s before file I/O', async (value) => {
    await expectRejected(rawArgs({ width: value, in: join(directory, 'missing.img') }), 'width')
  })

  it.each(['width', 'height', 'in-width', 'in-height'])('rejects trailing --%s without a value', async (flag) => {
    await expectRejected([...rawArgs({ [flag]: undefined }), `--${flag}`], flag)
  })

  it('does not treat the next flag as a dimension value', async () => {
    await expectRejected(['--width', ...rawArgs({ width: undefined })], 'width')
  })

  it.each(['in-width', 'in-height'])('still requires the source dimensions as a pair (missing %s)', async (flag) => {
    const result = await run(rawArgs({ [flag]: undefined }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('парой')
    expect(await readFile(output)).toEqual(sentinel)
  })

  it.each(['tif', 'png'])('rejects an invalid image dimension before reading a missing %s file', async (extension) => {
    const destination = join(directory, `absent-${extension}.raw`)
    const result = await run(['--in', join(directory, `missing.${extension}`), '--out', destination, '--width', '2.5', '--height', '1'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--width')
    expect(result.stderr).toMatch(/целым.*числом/i)
    expect(existsSync(destination)).toBe(false)
  })

  it('preserves valid fractional resampling ratios and fractional height scales', async () => {
    const result = await run([...rawArgs(), '--scale-meters', '0.5'])
    expect(result.status, result.stderr).toBe(0)
    const map = await readOutput()
    expect([map.width, map.height]).toEqual([3, 1])
    expect([map.minMeters, map.maxMeters]).toEqual([-80, 80])
    expect(Array.from(map.data)).toEqual([0, 32768, 65535])
  })

  it('keeps PNG input dimensions and values when explicitly requested', async () => {
    const result = await run(['--in', png, '--out', output, '--width', '2', '--height', '1'])
    expect(result.status, result.stderr).toBe(0)
    const map = await readOutput()
    expect([map.width, map.height]).toEqual([2, 1])
    expect([map.minMeters, map.maxMeters]).toEqual([0, 100])
    expect(Array.from(map.data)).toEqual([0, 65535])
  })

  it('preserves the elevation range and adjacent 16-bit PNG values in the written TEHM file', async () => {
    const source = join(directory, 'source16.png')
    await writeFile(source, DEM_16BIT_PNG)

    const result = await run(['--in', source, '--out', output, '--width', '8', '--height', '1'])

    expect(result.status, result.stderr).toBe(0)
    const map = await readOutput()
    expect([map.width, map.height]).toEqual([8, 1])
    expect([map.minMeters, map.maxMeters]).toEqual([0, 65535])
    expect(Array.from(map.data)).toEqual([0, 1, 255, 256, 10000, 10001, 32768, 65535])
  })

  it.each([
    { omit: 'width', other: 'height', expected: [8192, 1] },
    { omit: 'height', other: 'width', expected: [1, 4096] }
  ])('preserves the default when --$omit is omitted', async ({ omit, other, expected }) => {
    const result = await run(rawArgs({ [omit]: undefined, [other]: '1', 'min-meters': '-200', 'max-meters': '200' }))
    expect(result.status, result.stderr).toBe(0)
    const map = await readOutput()
    expect([map.width, map.height]).toEqual(expected)
    expect(map.data.length).toBe(expected[0] * expected[1])
  })
})
