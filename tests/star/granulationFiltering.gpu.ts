import {
  Camera, DataUtils, HalfFloatType, Mesh, NoBlending, PlaneGeometry,
  Scene, ShaderMaterial, Uniform, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { StarMaterial } from '@/core/materials/StarMaterial'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

const SIZE = 128
const SUPERSAMPLING = 16

// Контроль: исходная неотфильтрованная поверхность. Усредняем её RGB после
// палитры и энергии, а не сам шум: эти операции не коммутируют.
export const unfilteredStarReference = `
  ${noiseFunctions}
  uniform vec3 spectralColor, uColorCool, uColorHot;
  uniform float time, uGranulation, uCoreIntensity;
  uniform vec3 uLimbCoeff;
  varying vec3 vPosition, vPositionW, vCenterW;
  void main() {
    vec4 p = vec4(vPosition * 0.05, time);
    float n = 0.0, amplitude = 1.0, norm = 0.0, frequency = 1.0;
    for (int i = 0; i < 6; i++) {
      n += amplitude * snoise(p * frequency);
      norm += amplitude;
      amplitude *= 0.9;
      frequency *= 2.0;
    }
    float t = mix(0.5, clamp(0.5 + 4.0 * n / norm, 0.0, 1.0), uGranulation);
    vec3 color = t < 0.5 ? mix(uColorCool, spectralColor, 2.0 * t)
                        : mix(spectralColor, uColorHot, 2.0 * t - 1.0);
    float mu = clamp(dot(normalize(vPositionW - vCenterW), normalize(cameraPosition - vPositionW)), 0.0, 1.0);
    vec3 limb = clamp(vec3(1.0) - uLimbCoeff * (1.0 - mu), 0.0, 1.0);
    gl_FragColor = vec4(color * mix(0.55, 3.0, t) * uCoreIntensity * limb, 1.0);
  }
`

interface FilteringSample {
  temperature: number
  footprint: number
  time: number
  anisotropic: boolean
  relativeL1: number
  rgbMeanError: number
  motionError: number
  contrast: number
  referenceContrast: number
  pointRelativeL1: number
  pointMotionError: number
}

/**
 * await import('/tests/star/granulationFiltering.gpu.ts').then(m => m.checkStarGranulationFiltering())
 * Реальный фрагментный шейдер звезды на плоском участке с известным следом.
 * Независимый эталон — 256 выборок исходного полного спектра на пиксель.
 * Ловит потерю фильтрации, неверный масштаб следа и усиление оставшихся октав.
 */
export function checkStarGranulationFiltering(): { results: FilteringSample[] } {
  const renderer = new WebGLRenderer()
  renderer.setSize(SIZE, SIZE)
  const target = new WebGLRenderTarget(SIZE, SIZE, { type: HalfFloatType })
  const scene = new Scene(), camera = new Camera()
  const geometry = new PlaneGeometry(2, 2)
  const shaderErrors: string[] = []
  const results: FilteringSample[] = []
  const failures: string[] = []
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderErrors.push(gl.getProgramInfoLog(program) ?? '', gl.getShaderInfoLog(vertex) ?? '', gl.getShaderInfoLog(fragment) ?? '')
  }

  const render = (material: ShaderMaterial, resolution: number): Float32Array => {
    target.setSize(resolution, resolution)
    const quad = new Mesh(geometry, material)
    quad.frustumCulled = false
    scene.add(quad)
    try {
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      const pixels = new Uint16Array(resolution * resolution * 4)
      renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels)
      const error = renderer.getContext().getError()
      if (error || shaderErrors.length) throw new Error(`Granulation: WebGL ${error}, ${shaderErrors.join('\n')}`)
      const out = new Float32Array(SIZE * SIZE * 3)
      const scale = resolution / SIZE
      for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
        const src = (y * resolution + x) * 4
        const dst = (Math.floor(y / scale) * SIZE + Math.floor(x / scale)) * 3
        for (let c = 0; c < 3; c++) {
          const value = DataUtils.fromHalfFloat(pixels[src + c])
          if (!Number.isFinite(value) || value < 0) throw new Error(`Granulation: invalid radiance ${value}`)
          out[dst + c] += value / (scale * scale)
        }
      }
      return out
    } finally {
      scene.remove(quad)
      renderer.setRenderTarget(null)
    }
  }

  try {
    for (const temperature of [3354, 5778, 8000]) {
      const actor = {
        getAttribute: (_key: string, fallback?: unknown): unknown => fallback,
        physicalObject: {
          getAttribute: (key: string, fallback?: unknown): unknown => key === 'temperature' ? temperature : fallback
        }
      } as unknown as Actor
      const material = new StarMaterial(actor)
      material.uniforms.uLimbCoeff.value = new Vector3(0, 0, 0)
      material.uniforms.uSpan = new Uniform(new Vector2())
      material.uniforms.uOffset = new Uniform(new Vector2())
      // Наклон домена в 3D проверяет меру длины, а не только x/y-компоненты.
      material.vertexShader = `
        uniform vec2 uSpan, uOffset;
        varying vec3 vPosition, vPositionW, vCenterW;
        void main() {
          vec2 p = (position.xy * 0.5 + 0.5) * uSpan + uOffset;
          vPosition = vec3(p.x * 0.6, p.y, 1.7 + p.x * 0.8) / 0.05;
          vPositionW = vPosition;
          vCenterW = vec3(0.0);
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `
      material.depthTest = false
      material.depthWrite = false
      material.blending = NoBlending
      const reference = new ShaderMaterial({
        uniforms: material.uniforms, vertexShader: material.vertexShader,
        fragmentShader: unfilteredStarReference, depthTest: false, depthWrite: false, blending: NoBlending
      })
      try {
        for (const footprint of [0.001, 0.025, 0.1, 0.4, 1.2]) for (const time of [1.23, 4.56]) for (const anisotropic of [false, true]) {
          material.uniforms.time.value = time
          const fy = anisotropic ? footprint * 0.25 : footprint
          material.uniforms.uSpan.value.set(SIZE * footprint, SIZE * fy)
          material.uniforms.uOffset.value.set(0, 0)
          const low = render(material, SIZE)
          const point = render(reference, SIZE)
          const high = render(reference, SIZE * SUPERSAMPLING)
          material.uniforms.uOffset.value.set(footprint * 0.25, fy * 0.25)
          const movedLow = render(material, SIZE)
          const movedPoint = render(reference, SIZE)
          const movedHigh = render(reference, SIZE * SUPERSAMPLING)
          let energy = 0, diff = 0, motionDiff = 0, sum = 0, squaredSum = 0
          let pointDiff = 0, pointMotionDiff = 0, closeDiff = 0, highSum = 0, highSquaredSum = 0
          const meanLow = [0, 0, 0], meanHigh = [0, 0, 0]
          for (let i = 0; i < low.length; i++) {
            energy += high[i]
            diff += Math.abs(low[i] - high[i])
            motionDiff += Math.abs((movedLow[i] - low[i]) - (movedHigh[i] - high[i]))
            pointDiff += Math.abs(point[i] - high[i])
            closeDiff += Math.abs(point[i] - low[i])
            pointMotionDiff += Math.abs((movedPoint[i] - point[i]) - (movedHigh[i] - high[i]))
            meanLow[i % 3] += low[i]
            meanHigh[i % 3] += high[i]
            if (i % 3 === 0) { sum += low[i]; squaredSum += low[i] * low[i]; highSum += high[i]; highSquaredSum += high[i] * high[i] }
          }
          if (energy <= 0) throw new Error('Granulation: empty render')
          const contrast = Math.sqrt(Math.max(0, squaredSum / (SIZE * SIZE) - (sum / (SIZE * SIZE)) ** 2)) / (sum / (SIZE * SIZE))
          const result: FilteringSample = {
            temperature, footprint, time, anisotropic,
            relativeL1: diff / energy,
            rgbMeanError: Math.max(...meanLow.map((v, c) => Math.abs(v / meanHigh[c] - 1))),
            motionError: motionDiff / energy, contrast,
            referenceContrast: Math.sqrt(Math.max(0, highSquaredSum / (SIZE * SIZE) - (highSum / (SIZE * SIZE)) ** 2)) / (highSum / (SIZE * SIZE)),
            pointRelativeL1: pointDiff / energy, pointMotionError: pointMotionDiff / energy
          }
          results.push(result)
          // Вблизи все октавы разрешены: старая поверхность сохраняется.
          if (footprint === 0.001) {
            if (closeDiff / energy > 0.0001) failures.push(`Changed close surface: ${closeDiff / energy}`)
            continue
          }
          // Абсолютная ошибка зависит от следа и его анизотропии. Сравниваем
          // с точечной выборкой того же поля: минимум 10% улучшения картинки
          // и 30% улучшения движения, средняя энергия RGB в пределах 5%.
          if (result.relativeL1 > 0.9 * result.pointRelativeL1 || result.motionError > 0.7 * result.pointMotionError || result.rgbMeanError > 0.05) failures.push(JSON.stringify(result))
          // Сильное размытие тоже не проходит: разрешённый контраст сохраняется.
          if (footprint < 1 && (contrast < 0.8 * result.referenceContrast || contrast > 1.2 * result.referenceContrast)) failures.push(`Lost resolved detail: ${JSON.stringify(result)}`)
        }
      } finally {
        material.dispose()
        reference.dispose()
      }
    }
    if (failures.length) throw Object.assign(new Error(`Granulation: ${failures.length} failures\n${failures.slice(0, 4).join('\n')}`), { results })
    return { results }
  } finally {
    geometry.dispose()
    target.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
