import { Color } from 'three'
import { DeepPartial, NebulaParams, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'

export const NEBULA_PRESETS: Record<'emission' | 'reflection' | 'dark', DeepPartial<NebulaParams>> = {
  emission: {
    palette: { emissiveIntensity: 2.0, secondary: new Color(0x35d0ff) },
    noise: { ridged: 0.5, contrast: 1.7 }
  },
  reflection: {
    palette: {
      stops: [
        { t: 0.0, color: new Color(0x050a1a) },
        { t: 0.6, color: new Color(0x2a6fb0) },
        { t: 1.0, color: new Color(0xbfe3ff) }
      ],
      emissiveIntensity: 1.2
    },
    lighting: { scatterStrength: 1.2, ambient: 0.3 }
  },
  dark: {
    palette: { emissiveIntensity: 0.8 },
    dust: { strength: 0.9, threshold: 0.4 },
    noise: { contrast: 2.0 }
  }
}

export function makeNebulaParams(
  preset: keyof typeof NEBULA_PRESETS,
  overrides: DeepPartial<NebulaParams> = {}
): NebulaParams {
  return mergeNebulaParams(overrides, mergeNebulaParams(NEBULA_PRESETS[preset]))
}
