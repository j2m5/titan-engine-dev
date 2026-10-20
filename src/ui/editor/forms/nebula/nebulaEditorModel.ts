import { Color, Vector3 } from 'three'
import { toAstronomicalUnits } from '@/core/helpers/scaling'
import { makeDefaultNebulaParams, NEBULA_SHAPE_IDS } from '@/core/renderables/Nebula/NebulaParams'
import { makeNebulaParams } from '@/core/renderables/Nebula/presets'
import type { NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'

type GroupKey = 'gas' | 'dust' | 'structure' | 'noise' | 'palette' | 'lighting' | 'quality'
type Path = keyof NebulaRenderingData | { [K in GroupKey]: `${K}.${keyof NonNullable<NebulaRenderingData[K]> & string}` }[GroupKey]
export interface NebulaEditorField {
  path: Path
  label: string
  kind: 'number' | 'vector' | 'select' | 'boolean' | 'color'
  min?: number
  max?: number
  positive?: boolean
  integer?: boolean
  nullable?: string
  required?: boolean
  unit?: string
  options?: Array<{ value: string; label: string }>
  help?: string
}
interface Group { title: string; help: string; open?: boolean; fields: NebulaEditorField[] }
const number = (path: Path, label: string, options: Partial<NebulaEditorField> = {}): NebulaEditorField => ({ path, label, kind: 'number', ...options })
const unitRange = { min: 0, max: 1 }
const options = (values: string[]) => values.map((value) => ({ value, label: value }))

export const NEBULA_EDITOR_GROUPS: Group[] = [
  { title: 'Shape', help: 'Size is the half-extent in AU. Rotation uses degrees. Preset changes keep your explicit overrides.', fields: [
    { path: 'preset', label: 'Preset', kind: 'select', options: [{ value: '', label: 'Engine defaults' }, ...options(['emission', 'reflection', 'dark'])] },
    number('seed', 'Seed', { integer: true }), number('size', 'Half-size (AU)', { positive: true, required: true }),
    { path: 'shape', label: 'Shape', kind: 'select', options: options(Object.keys(NEBULA_SHAPE_IDS)) },
    number('shapeThickness', 'Shape thickness', { min: 0.02, max: 0.98, help: 'Shell wall, torus tube or hourglass waist; unused for ellipsoid and disk.' }),
    { path: 'axisRatios', label: 'Axis ratio', kind: 'vector', positive: true },
    { path: 'shapeRotation', label: 'Shape rotation', kind: 'vector', unit: '°' },
    number('edgeFalloff', 'Edge falloff', { positive: true })
  ] },
  { title: 'Gas & color', open: true, help: 'Gas density, absorption and emission are independent. Edit the full color gradient in Advanced JSON.', fields: [
    number('density', 'Gas density', { min: 0 }), number('gas.absorption', 'Gas absorption', { min: 0 }),
    number('palette.emissiveIntensity', 'Gas emission', { min: 0 }),
    { path: 'palette.secondary', label: 'Secondary color', kind: 'color' },
    number('palette.secondaryThreshold', 'Secondary threshold', unitRange),
    number('palette.radialMix', 'Radial color mix', unitRange),
    { path: 'palette.innerColor', label: 'Inner color', kind: 'color' },
    { path: 'palette.outerColor', label: 'Outer color', kind: 'color' }
  ] },
  { title: 'Dust', help: 'Dust absorbs light independently of gas. Its color affects scattered starlight; dust does not emit light.', fields: [
    number('dust.strength', 'Dust extinction', { min: 0 }), number('dust.threshold', 'Dust threshold', unitRange),
    { path: 'dust.color', label: 'Dust color', kind: 'color' },
    number('dust.seed', 'Dust seed', { integer: true, nullable: 'Inherit main seed' }),
    number('dust.frequency', 'Dust frequency', { min: 0.01, max: 32 }), number('dust.contrast', 'Dust contrast', { min: 0.1, max: 8 })
  ] },
  { title: 'Structure & noise', help: 'Stretch elongates gas filaments and dust lanes along the local direction. A stretch of 1 is isotropic.', fields: [
    { path: 'structure.direction', label: 'Structure direction', kind: 'vector' },
    number('structure.stretch', 'Structure stretch', { min: 1, max: 16 }),
    number('noise.octaves', 'Noise octaves', { min: 1, max: 8, integer: true }),
    number('noise.frequency', 'Noise frequency', { positive: true }),
    number('noise.lacunarity', 'Noise lacunarity', { positive: true }), number('noise.gain', 'Noise gain', unitRange),
    number('noise.warpStrength', 'Noise warp', { min: 0 }), number('noise.boundaryWarp', 'Boundary warp', unitRange),
    number('noise.ridged', 'Ridged noise', unitRange), number('noise.contrast', 'Noise contrast', { positive: true }),
    number('noise.worleyStrength', 'Worley strength', unitRange)
  ] },
  { title: 'Lighting', help: 'The optional star position is a fixed world-space point in engine units. It does not follow a moving star.', fields: [
    { path: 'lighting.starPosition', label: 'Star position', kind: 'vector', nullable: 'No star light' },
    { path: 'lighting.color', label: 'Light color', kind: 'color' },
    number('lighting.scatterStrength', 'Light scattering', { min: 0 }), number('lighting.ambient', 'Ambient light', { min: 0 }),
    number('lighting.falloffRadius', 'Light falloff radius', { min: 0, help: 'Local units; 0 disables distance falloff.' }),
    number('lighting.anisotropy', 'Light anisotropy', { min: -0.9, max: 0.9, nullable: 'Legacy lighting', help: 'Empty: legacy model. 0: isotropic. Positive values favor forward scattering.' }),
    number('lighting.shadowStrength', 'Self-shadow strength', unitRange)
  ] },
  { title: 'Quality', help: 'Resolution 0.5 reduces pixel cost. Temporal blend 0.85 smooths noise; 0 disables history. More ray/light steps cost more GPU time.', fields: [
    number('quality.maxSteps', 'Raymarch steps', { min: 8, max: 256, integer: true }),
    number('quality.lightSteps', 'Light steps', { min: 1, max: 16, integer: true }),
    number('quality.resolutionScale', 'Resolution scale', { min: 0.25, max: 1 }),
    number('quality.temporalBlend', 'Temporal blend', { min: 0, max: 0.95 }),
    { path: 'quality.forceLOD', label: 'LOD mode', kind: 'select', options: options(['auto', 'raymarch', 'impostor']) },
    { path: 'quality.bake3DTexture', label: 'Bake density texture', kind: 'boolean' },
    number('quality.bakeResolution', 'Bake resolution', { min: 64, max: 256, integer: true })
  ] }
]
export const NEBULA_EDITOR_FIELDS = NEBULA_EDITOR_GROUPS.flatMap((group) => group.fields)
export type ControlDrafts = Record<string, string>
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value)
}

/** Only clone the edited path. Arrays and unrepresented extensions remain intact. */
export function patchPath(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [key, child] = path.split('.')
  const next = { ...data }
  if (child) {
    const group = patchPath(isRecord(data[key]) ? data[key] : {}, child, value)
    if (Object.keys(group).length) next[key] = group
    else delete next[key]
  } else if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Color) return `#${value.getHexString()}`
  if (value instanceof Vector3) return value.toArray()
  if (Array.isArray(value)) return value.map(jsonValue)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]))
  return value
}
export function editorDefaults(data: unknown): Record<string, unknown> {
  const preset = readPath(data, 'preset')
  const params = preset === 'dark' || preset === 'emission' || preset === 'reflection' ? makeNebulaParams(preset) : makeDefaultNebulaParams()
  const result = jsonValue(params) as Record<string, unknown>
  result.size = toAstronomicalUnits(params.size)
  result.shapeRotation = params.shapeRotation.toArray().map((n) => n * 180 / Math.PI)
  const lighting = result.lighting as Record<string, unknown>
  lighting.color = params.lighting.color ? `#${params.lighting.color.getHexString()}` : '#ffffff'
  result.preset = ''
  return result
}
export function effectiveValue(data: unknown, defaults: unknown, path: string): unknown {
  const supplied = readPath(data, path)
  return supplied === undefined ? readPath(defaults, path) : supplied
}
export function parseNumber(text: string, field: NebulaEditorField): number | null {
  return text.trim() === '' ? (field.nullable ? null : NaN) : Number(text)
}
export function fieldError(field: NebulaEditorField, value: unknown): string | null {
  if (value === null && field.nullable) return null
  if (field.kind === 'number' || field.kind === 'vector') {
    const values = field.kind === 'vector' ? value : [value]
    if (!Array.isArray(values) || (field.kind === 'vector' && values.length !== 3)) return 'Enter three numbers.'
    if (values.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return 'Enter a finite number.'
    if (field.integer && values.some((n: number) => !Number.isInteger(n))) return 'Use a whole number.'
    if (field.positive && values.some((n: number) => n <= 0)) return 'Must be greater than 0.'
    if (field.min !== undefined && values.some((n: number) => n < field.min!)) return `Minimum: ${field.min}.`
    if (field.max !== undefined && values.some((n: number) => n > field.max!)) return `Maximum: ${field.max}.`
    if (field.path === 'structure.direction' && values.every((n: number) => n === 0)) return 'Direction must not be zero.'
  } else if (field.kind === 'color' && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) return 'Use a #rrggbb color.'
  else if (field.kind === 'boolean' && typeof value !== 'boolean') return 'Choose enabled or disabled.'
  else if (field.kind === 'select' && !field.options?.some((option) => option.value === value)) return 'Choose a listed option.'
  return null
}
export function draftedValue(field: NebulaEditorField, value: unknown, drafts: ControlDrafts): unknown {
  if (field.kind === 'number' && drafts[field.path] !== undefined) return parseNumber(drafts[field.path], field)
  if (field.kind === 'vector' && value !== null) {
    return [0, 1, 2].map((i) => drafts[`${field.path}.${i}`] !== undefined
      ? parseNumber(drafts[`${field.path}.${i}`], { ...field, nullable: undefined }) : Array.isArray(value) ? value[i] : undefined)
  }
  return value
}
export function structureError(data: unknown): string | null {
  if (!isRecord(data)) return 'Nebula data must be a JSON object.'
  for (const key of ['gas', 'dust', 'structure', 'noise', 'palette', 'lighting', 'quality']) {
    if (data[key] !== undefined && !isRecord(data[key])) return `${key} must be a JSON object. Correct it in Advanced JSON.`
  }
  return null
}
export function controlError(data: unknown, drafts: ControlDrafts): string | null {
  const malformed = structureError(data)
  if (malformed) return malformed
  const defaults = editorDefaults(data)
  for (const field of NEBULA_EDITOR_FIELDS) {
    if (field.required && readPath(data, field.path) === undefined) return `${field.label}: enter a value.`
    const error = fieldError(field, draftedValue(field, effectiveValue(data, defaults, field.path), drafts))
    if (error) return `${field.label}: ${error}`
  }
  return null
}
