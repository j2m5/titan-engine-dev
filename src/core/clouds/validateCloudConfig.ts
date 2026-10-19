import type {
  CloudColor,
  CloudConfigIssue,
  CloudConfigResult,
  CloudLayerConfig,
  CloudMapRef,
  CloudPattern,
  ScalarDecode
} from './CloudConfig'
import type { SurfaceCloudMap } from './SceneCloudConfig'

type RecordValue = Record<string, unknown>

class CloudReader {
  readonly issues: CloudConfigIssue[] = []
  constructor(private readonly resourceIds: ReadonlySet<number>) {}

  issue(path: string, message: string): void {
    this.issues.push({ path, message })
  }
  object(value: unknown, path: string): RecordValue {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as RecordValue
    }
    this.issue(path, 'Expected an object')
    return {}
  }
  number(value: unknown, path: string, min = -Infinity, max = Infinity, positive = false): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (positive && value <= 0)
    ) {
      this.issue(path, 'Expected a finite number in the permitted range')
      return 0
    }
    return value
  }
  boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') this.issue(path, 'Expected a boolean')
    return value === true
  }
  choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
    const choice = choices.find((candidate) => candidate === value)
    if (choice === undefined) this.issue(path, 'Unknown variant')
    return choice ?? choices[0]
  }
  tuple(value: unknown, path: string, unit = false): [number, number] {
    if (!Array.isArray(value) || value.length !== 2) {
      this.issue(path, 'Expected a pair of numbers')
      return [0, 1]
    }
    const low = this.number(value[0], path + '[0]', unit ? 0 : -Infinity, unit ? 1 : Infinity)
    const high = this.number(value[1], path + '[1]', unit ? 0 : -Infinity, unit ? 1 : Infinity)
    if (unit ? low > high : low >= high) this.issue(path, 'Invalid range order')
    return [low, high]
  }
  map(value: unknown, path: string): CloudMapRef {
    const data = this.object(value, path)
    const resourceId = this.number(data.resourceId, path + '.resourceId')
    if (!Number.isInteger(resourceId) || !this.resourceIds.has(resourceId)) {
      this.issue(path + '.resourceId', 'Resource is unavailable for this actor')
    }
    return { resourceId }
  }
  decode(value: unknown, path: string): ScalarDecode {
    const data = this.object(value, path)
    return {
      channel: this.choice(data.channel, path + '.channel', ['r', 'g', 'b', 'a', 'luminance']),
      inputRange: this.tuple(data.inputRange, path + '.inputRange'),
      exponent: this.number(data.exponent, path + '.exponent', 0, Infinity, true),
      invert: this.boolean(data.invert, path + '.invert'),
      sampleSpace: this.choice(data.sampleSpace, path + '.sampleSpace', ['encoded', 'linear'])
    }
  }
  pattern(value: unknown, path: string): CloudPattern {
    const data = this.object(value, path)
    const kind = this.choice(data.kind, path + '.kind', ['uniform', 'procedural', 'mask', 'appearance'])
    if (kind === 'uniform' || kind === 'procedural') {
      const coverage = this.number(data.coverage, path + '.coverage', 0, 1)
      return kind === 'uniform'
        ? { kind, coverage }
        : {
            kind,
            coverage,
            scaleMeters: this.number(data.scaleMeters, path + '.scaleMeters', 0, Infinity, true),
            bandStrength: this.number(data.bandStrength, path + '.bandStrength', 0, 1)
          }
    }
    const map = this.map(data.map, path + '.map')
    if (kind === 'mask' && data.encoding === 'rgb-cloud-map') return { kind, encoding: 'rgb-cloud-map', map }
    if (kind === 'mask' && data.encoding !== undefined && data.encoding !== 'scalar') {
      this.issue(path + '.encoding', 'Unknown variant')
    }
    const decode = this.decode(data.decode, path + '.decode')
    return kind === 'mask'
      ? { kind, ...(data.encoding === 'scalar' ? { encoding: 'scalar' as const } : {}), map, decode }
      : {
          kind,
          map,
          decode,
          coverageRange: this.tuple(data.coverageRange, path + '.coverageRange', true)
        }
  }
  mapping(value: unknown): SurfaceCloudMap['mapping'] {
    const mapping = this.object(value, 'mapping')
    return {
      frame: this.choice(mapping.frame, 'mapping.frame', ['planet-fixed']),
      projection: this.choice(mapping.projection, 'mapping.projection', ['equirectangular']),
      longitudeOffsetRadians: this.number(mapping.longitudeOffsetRadians, 'mapping.longitudeOffsetRadians')
    }
  }
  color(value: unknown, path: string): CloudColor {
    const data = this.object(value, path)
    const kind = this.choice(data.kind, path + '.kind', ['constant', 'map'])
    if (kind === 'map')
      return {
        kind,
        map: this.map(data.map, path + '.map'),
        strength: this.number(data.strength, path + '.strength', 0, 1)
      }
    if (!Array.isArray(data.srgb) || data.srgb.length !== 3) {
      this.issue(path + '.srgb', 'Expected RGB triple')
      return { kind, srgb: [0, 0, 0] }
    }
    return {
      kind,
      srgb: [
        this.number(data.srgb[0], path + '.srgb[0]', 0, 1),
        this.number(data.srgb[1], path + '.srgb[1]', 0, 1),
        this.number(data.srgb[2], path + '.srgb[2]', 0, 1)
      ]
    }
  }
  layer(value: unknown, path: string): CloudLayerConfig {
    const data = this.object(value, path)
    const id = typeof data.id === 'string' ? data.id : ''
    if (id.trim().length === 0) this.issue(path + '.id', 'Expected a nonempty layer id')
    const detail = this.object(data.detail, path + '.detail')
    const seed = this.number(detail.seed, path + '.detail.seed')
    if (!Number.isInteger(seed)) this.issue(path + '.detail.seed', 'Expected an integer seed')
    const baseAltitudeMeters = this.number(data.baseAltitudeMeters, path + '.baseAltitudeMeters', 0)
    const thicknessMeters = this.number(data.thicknessMeters, path + '.thicknessMeters', 0, Infinity, true)
    if (!Number.isFinite(baseAltitudeMeters + thicknessMeters)) {
      this.issue(path + '.thicknessMeters', 'Shell upper altitude must be finite')
    }
    return {
      id,
      baseAltitudeMeters,
      thicknessMeters,
      extinctionPerMeter: this.number(data.extinctionPerMeter, path + '.extinctionPerMeter', 0, Infinity, true),
      pattern: this.pattern(data.pattern, path + '.pattern'),
      color: this.color(data.color, path + '.color'),
      detail: {
        seed,
        shapeScaleMeters: this.number(detail.shapeScaleMeters, path + '.detail.shapeScaleMeters', 0, Infinity, true),
        erosionScaleMeters: this.number(
          detail.erosionScaleMeters,
          path + '.detail.erosionScaleMeters',
          0,
          Infinity,
          true
        ),
        erosionStrength: this.number(detail.erosionStrength, path + '.detail.erosionStrength', 0, 1),
        ...(detail.verticalProfileBias !== undefined
          ? {
              verticalProfileBias: this.number(
                detail.verticalProfileBias,
                path + '.detail.verticalProfileBias',
                0,
                1,
                true
              )
            }
          : {})
      },
      castsShadow: this.boolean(data.castsShadow, path + '.castsShadow')
    }
  }
}

export function resolveCloudConfig(value: unknown, availableResourceIds: ReadonlySet<number>): CloudConfigResult {
  if (value === undefined) return { state: 'unconfigured' }
  const reader = new CloudReader(availableResourceIds)
  const data = reader.object(value, 'clouds')
  if (data.enabled === false) return { state: 'off' }
  if (data.enabled !== true) {
    reader.issue('enabled', 'Expected a boolean')
    return { state: 'invalid', issues: reader.issues }
  }
  const mapping = reader.mapping(data.mapping)
  const lod = reader.object(data.lod, 'lod')
  const fullDistanceMeters = reader.number(lod.fullDistanceMeters, 'lod.fullDistanceMeters', 0)
  const cutoffDistanceMeters = reader.number(lod.cutoffDistanceMeters, 'lod.cutoffDistanceMeters', 0)
  if (cutoffDistanceMeters <= fullDistanceMeters) {
    reader.issue('lod.cutoffDistanceMeters', 'Cutoff must exceed full distance')
  }
  const layers: CloudLayerConfig[] = []
  if (!Array.isArray(data.layers) || data.layers.length === 0) {
    reader.issue('layers', 'Expected at least one layer')
  } else {
    const ids = new Set<string>()
    for (let i = 0; i < data.layers.length; i++) {
      const layer = reader.layer(data.layers[i], 'layers[' + i + ']')
      if (ids.has(layer.id)) reader.issue('layers[' + i + '].id', 'Duplicate layer id')
      ids.add(layer.id)
      layers.push(layer)
    }
  }
  const config = {
    enabled: true as const,
    farAppearance: reader.choice(data.farAppearance, 'farAppearance', ['base-texture', 'surface-map']),
    mapping,
    lod: { fullDistanceMeters, cutoffDistanceMeters },
    layers
  }
  return reader.issues.length > 0 ? { state: 'invalid', issues: reader.issues } : { state: 'configured', config }
}

export function resolveSurfaceCloudMap(
  value: SurfaceCloudMap,
  availableResourceIds: ReadonlySet<number>
): {
  far: SurfaceCloudMap | null
  issues: CloudConfigIssue[]
} {
  const reader = new CloudReader(availableResourceIds)
  const pattern = reader.pattern(value.pattern, 'pattern')
  const mapping = reader.mapping(value.mapping)
  const color = reader.color(value.color, 'color')
  if (pattern.kind !== 'mask') reader.issue('pattern.kind', 'Surface clouds require a mask')
  return {
    far: reader.issues.length === 0 && pattern.kind === 'mask' ? { pattern, mapping, color } : null,
    issues: reader.issues
  }
}
