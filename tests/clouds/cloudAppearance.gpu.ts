import {
  Camera,
  DataTexture,
  GLSL3,
  Matrix3,
  Mesh,
  NearestFilter,
  NoBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { CloudsEffect } from '@takram/three-clouds'
import { validCloudConfig } from './cloudFixtures'

export type CloudAppearanceGpuReport = {
  samples: number
  maxCloudUvError: number
  maxShadowUvError: number
  maxColorError: number
  maxAlphaDifference: number
  maxShadowDifference: number
  resourcesReleased: boolean
}

function extract(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:vec[234]|float|WeatherSample) ${name}\\(`))
  if (start < 0) throw new Error(`Missing shader function ${name}`)
  let end = source.indexOf('{', start),
    depth = 1
  while (depth && ++end < source.length) {
    if (source[end] === '{') depth++
    if (source[end] === '}') depth--
  }
  return source.slice(start, end + 1)
}

/** Execute material source, with a fixed homogeneous medium for the integration probe. */
export async function checkCloudAppearance(useAdapter = true): Promise<CloudAppearanceGpuReport> {
  const renderer = new WebGLRenderer()
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(
      `Appearance probe shader failed: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
    )
  }
  const clouds = new CloudsEffect(new PerspectiveCamera())
  const bytes = new Uint8Array(64 * 32 * 4)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4
      bytes[i] = y === 0 || y === 31 ? 128 : Math.round((0.5 + 0.4 * Math.cos((2 * Math.PI * (x + 0.5)) / 64)) * 255)
      bytes[i + 1] = Math.round(((y + 0.5) / 32) * 255)
      bytes[i + 2] = x >= 9 && x < 19 && y >= 17 && y < 26 ? 255 : 0
      bytes[i + 3] = 255
    }
  const texture = new DataTexture(bytes, 64, 32, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.minFilter = texture.magFilter = NearestFilter
  texture.needsUpdate = true
  let maps:
    | ReturnType<typeof import('@/labs/jupiter-clouds/cloudAppearanceTextures').prepareCloudAppearanceTextures>
    | undefined
  let binding: ReturnType<typeof import('@/labs/jupiter-clouds/cloudAppearance').bindCloudAppearance> | undefined
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false })
  const geometry = new PlaneGeometry(2, 2)
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    vertexShader: 'precision highp float; in vec3 position; void main(){gl_Position=vec4(position.xy,0.,1.);}'
  })
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const report: CloudAppearanceGpuReport = {
    samples: 0,
    maxCloudUvError: 0,
    maxShadowUvError: 0,
    maxColorError: 0,
    maxAlphaDifference: 0,
    maxShadowDifference: 0,
    resourcesReleased: false
  }
  const run = (body: string, declarations: string, uniforms: RawShaderMaterial['uniforms']): number[] => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      if (material.uniforms[name]) material.uniforms[name].value = uniform.value
      else material.uniforms[name] = { value: uniform.value }
    }
    material.fragmentShader = `precision highp float; precision highp sampler2D; out vec4 result; ${declarations} void main(){${body}}`
    material.needsUpdate = true
    renderer.setRenderTarget(target)
    renderer.render(scene, new Camera())
    const pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    if (renderer.getContext().getError()) throw new Error('Appearance probe WebGL error')
    return Array.from(pixel, (value) => value / 255)
  }
  try {
    const config = validCloudConfig()
    config.mapping.longitudeOffsetRadians = 0.23
    if (useAdapter) {
      const texturesPath = '/src/labs/jupiter-clouds/cloudAppearanceTextures.ts'
      const adapterPath = '/src/labs/jupiter-clouds/cloudAppearance.ts'
      const preparation = await import(/* @vite-ignore */ texturesPath)
      const adapter = await import(/* @vite-ignore */ adapterPath)
      const prepared: NonNullable<typeof maps> = preparation.prepareCloudAppearanceTextures(
        config.layers[0],
        () => texture
      )
      maps = prepared
      binding = adapter.bindCloudAppearance(clouds, config, prepared)
      // Nearest sampling isolates geography from resampling/filter differences.
      prepared.color!.minFilter = prepared.color!.magFilter = NearestFilter
    }
    const directions = [
      [0, 1, 0],
      [0, -1, 0],
      [-1, 0, 0.0001],
      [-1, 0, -0.0001],
      [1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1, 1, 1],
      [-1, 2, 3],
      [2, -1, 3],
      [-3, -2, 1],
      [1, 3, -2]
    ].map((v) => new Vector3(...v).normalize())
    const rotations = [
      new Quaternion(),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.71)
    ]
    for (const rotation of rotations)
      for (const translated of [false, true]) {
        binding?.setPlanetRotation(rotation)
        const origin = translated ? new Vector3(1200, -400, 69925200) : new Vector3()
        clouds.worldToECEFMatrix.makeTranslation(origin.x, origin.y, origin.z)
        for (const direction of directions) {
          const world = direction.clone().applyQuaternion(rotation).multiplyScalar(69925200).sub(origin)
          const u0 = (Math.atan2(direction.z, -direction.x) + config.mapping.longitudeOffsetRadians) / (2 * Math.PI)
          const expected = [
            (direction.x * direction.x + direction.z * direction.z > 1e-12
              ? u0
              : config.mapping.longitudeOffsetRadians / (2 * Math.PI)) % 1,
            1 - Math.acos(direction.y) / Math.PI
          ]
          expected[0] = (expected[0] + 1) % 1
          for (const [passName, pass] of [
            ['cloud', clouds.cloudsPass],
            ['shadow', clouds.shadowPass]
          ] as const) {
            const source = pass.currentMaterial.fragmentShader
            const declarations = `const float RECIPROCAL_PI2=0.1591549430918953, RECIPROCAL_PI=0.3183098861837907; uniform mat3 cloudECEFToPlanet; uniform float cloudLongitudeOffset; uniform mat4 worldToECEFMatrix; uniform vec3 probePosition; uniform sampler2D cloudColorTexture; ${extract(source, 'getCubeSphereUv')} ${extract(source, 'getGlobeUv')}`
            const uniforms = {
              ...pass.currentMaterial.uniforms,
              probePosition: { value: world },
              worldToECEFMatrix: { value: clouds.worldToECEFMatrix },
              cloudColorTexture: { value: maps?.color ?? texture },
              cloudECEFToPlanet: pass.currentMaterial.uniforms.cloudECEFToPlanet ?? { value: new Matrix3() },
              cloudLongitudeOffset: { value: config.mapping.longitudeOffsetRadians }
            }
            const uv = run(
              'vec2 uv=getGlobeUv((worldToECEFMatrix*vec4(probePosition,1.)).xyz); result=vec4(uv,0.,1.);',
              declarations,
              uniforms
            )
            const error = Math.max(
              Math.min(Math.abs(uv[0] - expected[0]), 1 - Math.abs(uv[0] - expected[0])),
              Math.abs(uv[1] - expected[1])
            )
            if (passName === 'cloud') report.maxCloudUvError = Math.max(report.maxCloudUvError, error)
            else report.maxShadowUvError = Math.max(report.maxShadowUvError, error)
            const color = run(
              'result=textureLod(cloudColorTexture,getGlobeUv((worldToECEFMatrix*vec4(probePosition,1.)).xyz),0.);',
              declarations,
              uniforms
            )
            const x = Math.min(63, Math.floor(expected[0] * 64)),
              y = Math.min(31, Math.floor(expected[1] * 32)),
              index = (y * 64 + x) * 4
            for (let c = 0; c < 3; c++)
              report.maxColorError = Math.max(report.maxColorError, Math.abs(color[c] - bytes[index + c] / 255))
            if (maps) {
              maps.weather.minFilter = maps.weather.magFilter = NearestFilter
              const weatherDeclarations = `${declarations}
              ${passName === 'shadow' ? '#define SHADOW\n' : ''}
              struct WeatherSample {vec4 heightFraction;vec4 density;};
              uniform sampler2D localWeatherTexture;
              uniform vec4 minLayerHeights,maxLayerHeights,shapeAlteringBiases,shadowLayerMask;
              vec4 remapClamped(vec4 x,vec4 low,vec4 high){return clamp((x-low)/(high-low),0.,1.);}
              ${extract(source, 'shapeAlteringFunction')} ${extract(source, 'sampleWeather')}`
              const density = run(
                'vec2 uv=getGlobeUv((worldToECEFMatrix*vec4(probePosition,1.)).xyz); result=sampleWeather(uv,0.5,0.).density;',
                weatherDeclarations,
                {
                  ...uniforms,
                  localWeatherTexture: { value: maps.weather },
                  minLayerHeights: { value: new Vector4(0, 0, 0, 0) },
                  maxLayerHeights: { value: new Vector4(1, 1, 1, 1) },
                  shapeAlteringBiases: { value: new Vector4(1, 1, 1, 1) },
                  shadowLayerMask: { value: new Vector4(1, 0, 0, 0) }
                }
              )
              report.maxColorError = Math.max(
                report.maxColorError,
                Math.abs(density[0] - (maps.weather.image.data as Uint8Array)[index] / 255),
                ...density.slice(1).map(Math.abs)
              )
            }
          }
          report.samples++
        }
      }
    if (binding) {
      clouds.qualityPreset = 'high'
      for (const rotation of rotations) {
        binding.setPlanetRotation(rotation)
        for (const [passName, pass] of [
          ['cloud', clouds.cloudsPass],
          ['shadow', clouds.shadowPass]
        ] as const) {
          for (const [name, expected] of [
            ['shapePosition', [0.25, 0.33, 0.39]],
            ['detailPosition', [0.24, 0.35, 0.36]]
          ] as const) {
            const statement = pass.currentMaterial.fragmentShader.match(new RegExp(`vec3 ${name} = [^;]+;`))?.[0]
            if (!statement) throw new Error(`Missing shader noise expression ${name}`)
            const actual = run(
              `${statement} result=vec4(${name},1.);`,
              'uniform mat3 cloudECEFToPlanet; uniform vec3 position,evolution,turbulence,shapeRepeat,shapeDetailRepeat,shapeOffset,shapeDetailOffset;',
              {
                cloudECEFToPlanet: pass.currentMaterial.uniforms.cloudECEFToPlanet,
                position: { value: new Vector3(0.12, 0.25, 0.4).applyQuaternion(rotation) },
                evolution: { value: new Vector3(0.01, -0.02, 0.03).applyQuaternion(rotation) },
                turbulence: { value: new Vector3(0.09, 0.04, -0.05) },
                shapeRepeat: { value: new Vector3(1, 1, 1) },
                shapeDetailRepeat: { value: new Vector3(1, 1, 1) },
                shapeOffset: { value: new Vector3(0.03, 0.06, 0.01) },
                shapeDetailOffset: { value: new Vector3(0.03, 0.06, 0.01) }
              }
            )
            const error = Math.max(...expected.map((value, i) => Math.abs(actual[i] - value)))
            if (error > 1 / 255)
              throw new Error(
                `Planet-fixed turbulence regression: ${passName} ${name} error=${error}, actual=${JSON.stringify(actual.slice(0, 3))}, expected=${JSON.stringify(expected)}`
              )
          }
        }
      }
    }
    const cloudSource = clouds.cloudsPass.currentMaterial.fragmentShader
    const multiply = cloudSource.slice(
      cloudSource.indexOf('// Finally multiply by scattering.') + '// Finally multiply by scattering.'.length,
      cloudSource.indexOf('#ifdef POWDER', cloudSource.indexOf('// Finally multiply by scattering.'))
    )
    const integral = cloudSource.slice(
      cloudSource.indexOf(
        'float transmittance = exp(-media.extinction * stepSize);',
        cloudSource.indexOf('// Finally multiply by scattering.')
      ),
      cloudSource.indexOf(
        '// Aerial perspective affecting clouds',
        cloudSource.indexOf('// Finally multiply by scattering.')
      )
    )
    const shadowSource = clouds.shadowPass.currentMaterial.fragmentShader
    const shadowStep = shadowSource.slice(
      shadowSource.indexOf('extinctionSum += media.extinction;'),
      shadowSource.indexOf('++sampleCount;', shadowSource.indexOf('extinctionSum += media.extinction;'))
    )
    const values = [
      [1, 1, 1, 1],
      [1, 0, 0, 1],
      [0, 0, 1, 1],
      [1, 0, 0, 0]
    ]
    for (const extinction of [0, 1]) {
      const outputs = values.map(([r, g, b, strength]) =>
        run(
          `MediaSample media; media.scattering=probeExtinction; media.extinction=probeExtinction; vec2 uv=vec2(.5); float mipLevel=0.,stepSize=1.; vec3 radiance=vec3(1.),radianceIntegral=vec3(0.); float transmittanceIntegral=1.; ${multiply} ${integral} result=vec4(radianceIntegral,1.-transmittanceIntegral);`,
          'struct MediaSample{float scattering;float extinction;}; uniform float probeExtinction; uniform bool cloudUseColorMap; uniform sampler2D cloudColorTexture; uniform vec3 cloudConstantColor; uniform float cloudColorStrength,cloudColorMipBias;',
          {
            probeExtinction: { value: extinction },
            cloudUseColorMap: { value: false },
            cloudColorTexture: { value: texture },
            cloudConstantColor: { value: new Vector3(r, g, b) },
            cloudColorStrength: { value: strength },
            cloudColorMipBias: { value: 0 }
          }
        )
      )
      const expectedAlpha = 1 - Math.exp(-extinction)
      for (let i = 0; i < outputs.length; i++) {
        report.maxAlphaDifference = Math.max(
          report.maxAlphaDifference,
          Math.abs(outputs[i][3] - outputs[0][3]),
          Math.abs(outputs[i][3] - expectedAlpha)
        )
        const albedo = i === 1 ? [1, 0, 0] : i === 2 ? [0, 0, 1] : [1, 1, 1]
        for (let c = 0; c < 3; c++)
          report.maxColorError = Math.max(report.maxColorError, Math.abs(outputs[i][c] - expectedAlpha * albedo[c]))
      }
      const shadows = values.map(([r, g, b, strength]) =>
        run(
          `MediaSample media;media.extinction=probeExtinction;float extinctionSum=0.,maxOpticalDepth=0.,stepSize=1.,transmittanceIntegral=1.,weightedDistanceSum=0.,transmittanceSum=0.,rayDistance=1.; ${shadowStep} result=vec4(maxOpticalDepth,transmittanceIntegral,extinctionSum,1.);`,
          'struct MediaSample{float extinction;};uniform float probeExtinction;uniform vec3 cloudConstantColor;uniform float cloudColorStrength;',
          {
            probeExtinction: { value: extinction },
            cloudConstantColor: { value: new Vector3(r, g, b) },
            cloudColorStrength: { value: strength }
          }
        )
      )
      for (const output of shadows)
        for (let c = 0; c < 4; c++)
          report.maxShadowDifference = Math.max(report.maxShadowDifference, Math.abs(output[c] - shadows[0][c]))
    }
  } finally {
    binding?.dispose()
    maps?.dispose()
    texture.dispose()
    target.dispose()
    geometry.dispose()
    material.dispose()
    clouds.dispose()
    renderer.setRenderTarget(null)
    report.resourcesReleased = renderer.info.memory.textures === 0 && renderer.info.memory.geometries === 0
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return report
}
