import { expect, test } from 'vitest'
import { parseCloudBenchmarkOptions } from '../../scripts/lib/scene-cloud-benchmark.mjs'

test('benchmark accepts a scoped run and expands all selections', () => {
  const options = parseCloudBenchmarkOptions(['--quality=medium', '--view=inside', '--samples=128', '--repeats=1'])
  expect(options.qualities).toEqual(['medium'])
  expect(options.views).toEqual(['inside'])
  expect(options.samples).toBe(128)
  expect(options.repeats).toBe(1)
  expect(options.stages).toEqual(['cloud-current', 'cloud-resolve', 'shadows', 'depth', 'frame'])
  const all = parseCloudBenchmarkOptions([])
  expect(all.qualities).toEqual(['low', 'medium', 'high'])
  expect(all.views).toEqual(['above', 'inside'])
})

test.each([
  ['--samples=0'],
  ['--samples=65'],
  ['--samples=Infinity'],
  ['--samples=8192'],
  ['--width=-1'],
  ['--height=0'],
  ['--width=1920x'],
  ['--width=99999'],
  ['--repeats=0'],
  ['--repeats=1.5'],
  ['--repeats=100'],
  ['--quality=off'],
  ['--view=orbit'],
  ['--stage=near'],
  ['--unknown=1'],
  ['--quality=low', '--quality=high'],
  ['--quality'],
  ['--samples=64=2']
])('benchmark rejects invalid or ambiguous options: %j', (...args) => {
  expect(() => parseCloudBenchmarkOptions(args)).toThrow(/Invalid|Duplicate|Unknown/)
})
