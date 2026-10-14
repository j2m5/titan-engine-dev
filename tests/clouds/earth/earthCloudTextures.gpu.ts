import {
  DataTexture,
  Texture,
  RGBAFormat,
  SRGBColorSpace,
  NearestFilter,
  RepeatWrapping,
  PerspectiveCamera,
  Vector3,
  Vector4
} from 'three'
import { CloudsEffect } from '@takram/three-clouds'
import { rgbCloudMapGLSL } from '@/labs/earth-clouds/rgbCloudMap'
import { prepareRgbCloudTextures } from '@/labs/earth-clouds/earthCloudTextures'
import {
  prepareCloudAppearanceTextures,
  type CloudAppearanceTextures
} from '@/labs/jupiter-clouds/cloudAppearanceTextures'
import { bindCloudAppearance } from '@/labs/jupiter-clouds/cloudAppearance'
import { createEarthCloudProfile } from '@/labs/earth-clouds/earthCloudProfile'
import { createGpuReadback, extractShaderFunction, type EarthGpuProbeReport } from './gpuTestHarness'

export async function checkEarthCloudTextures(): Promise<EarthGpuProbeReport> {
  const gpu = createGpuReadback(),
    owned = new Set<Texture>(),
    maps: CloudAppearanceTextures[] = []
  const clouds = new CloudsEffect(new PerspectiveCamera())
  let binding: ReturnType<typeof bindCloudAppearance> | undefined
  const report: EarthGpuProbeReport = { name: 'earth-cloud-maps', checks: 0, maxError: 0, resourcesReleased: false }
  const check = (actual: readonly number[], expected: readonly number[], label: string) => {
    const error = Math.max(...expected.map((x, i) => Math.abs(actual[i] - x)))
    if (!Number.isFinite(error) || error > 2 / 255)
      throw new Error(`${label}: ${JSON.stringify({ actual, expected, error })}`)
    report.maxError = Math.max(report.maxError, error)
    report.checks++
  }
  const nearest = (texture: Texture) => {
    texture.minFilter = texture.magFilter = NearestFilter
    texture.wrapS = RepeatWrapping
    texture.needsUpdate = true
    return texture
  }
  try {
    // Independent numeric expectations: black, white, red, encoded 128 gray,
    // green and encoded 64 gray. This is deliberately asymmetric (3 x 2).
    const rgb = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [128, 128, 128],
      [0, 255, 0],
      [64, 64, 64]
    ]
    const expected = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [1, 0, 0, 0.577350269],
      [0.4646215, 0.4646215, 0.4646215, 0.4646215],
      [0, 1, 0, 0.577350269],
      [0.2264262, 0.2264262, 0.2264262, 0.2264262]
    ]
    const bytes = new Uint8Array(rgb.flatMap((x) => [...x, 255]))
    const data = nearest(new DataTexture(bytes, 3, 2, RGBAFormat))
    data.colorSpace = SRGBColorSpace
    owned.add(data)
    const canvas = document.createElement('canvas')
    canvas.width = 3
    canvas.height = 2
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bytes), 3, 2), 0, 0)
    const image = new Image()
    image.src = canvas.toDataURL()
    await image.decode()
    image.width = 1
    image.height = 1
    const html = nearest(new Texture(image))
    html.colorSpace = SRGBColorSpace
    owned.add(html)
    for (const source of [data, html])
      for (const flipY of [false, true]) {
        source.flipY = flipY
        source.needsUpdate = true
        const prepared = prepareRgbCloudTextures(source)
        maps.push(prepared)
        nearest(prepared.weather)
        nearest(prepared.color!)
        if (prepared.weather.image.width !== 3 || prepared.weather.image.height !== 2)
          throw new Error('CSS dimensions replaced natural size')
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 3; x++)
            for (const seam of [0, 1, -1]) {
              const uv = new Vector3((x + 0.5) / 3 + seam, (y + 0.5) / 2, 0),
                index = (flipY ? 1 - y : y) * 3 + x
              const actual = gpu.run(
                'RgbCloudSample cloudSample=decodeRgbCloud(texture2D(sourceMap,probeUv.xy).rgb);gl_FragColor=vec4(cloudSample.albedo,cloudSample.coverage);',
                `uniform sampler2D sourceMap;uniform vec3 probeUv;${rgbCloudMapGLSL}`,
                { sourceMap: { value: source }, probeUv: { value: uv } }
              )
              check(
                actual,
                expected[index],
                `codec ${source === data ? 'Data' : 'HTML'} flip=${flipY} texel=${index} seam=${seam}`
              )
              const derived = gpu.run(
                'gl_FragColor=vec4(texture2D(colorMap,probeUv.xy).rgb,texture2D(weatherMap,probeUv.xy).r);',
                'uniform sampler2D colorMap,weatherMap;uniform vec3 probeUv;',
                { colorMap: { value: prepared.color }, weatherMap: { value: prepared.weather }, probeUv: { value: uv } }
              )
              check(derived, expected[index], 'prepared orientation/linear maps')
            }
      }
    const plain = nearest(new DataTexture(new Uint8Array([64, 0, 0, 255]), 1, 1, RGBAFormat))
    owned.add(plain)
    const config = createEarthCloudProfile(),
      mask = prepareCloudAppearanceTextures(config.layers[0], () => plain)
    maps.push(mask)
    nearest(mask.weather)
    binding = bindCloudAppearance(clouds, config, mask)
    const cloudSource = clouds.cloudsPass.currentMaterial.fragmentShader,
      shadowSource = clouds.shadowPass.currentMaterial.fragmentShader
    const weatherDeclarations = `struct WeatherSample {vec4 heightFraction;vec4 density;}; uniform sampler2D localWeatherTexture;uniform vec4 minLayerHeights,maxLayerHeights,shapeAlteringBiases,shadowLayerMask;vec4 remapClamped(vec4 x,vec4 low,vec4 high){return clamp((x-low)/(high-low),0.,1.);}`
    for (const source of [cloudSource, shadowSource]) {
      const density = gpu.run(
        'gl_FragColor=sampleWeather(vec2(.5),.5,0.).density;',
        `${source === shadowSource ? '#define SHADOW\n' : ''}${weatherDeclarations}${extractShaderFunction(source, 'shapeAlteringFunction')}${extractShaderFunction(source, 'sampleWeather')}`,
        {
          localWeatherTexture: { value: mask.weather },
          minLayerHeights: { value: new Vector4(0, 0, 0, 0) },
          maxLayerHeights: { value: new Vector4(1, 1, 1, 1) },
          shapeAlteringBiases: { value: new Vector4(1, 1, 1, 1) },
          shadowLayerMask: { value: new Vector4(1, 0, 0, 0) }
        }
      )
      check(density, [0.25, 0, 0, 0], 'actual mask weather path')
    }
    const marker = cloudSource.indexOf('// Finally multiply by scattering.')
    const multiply = cloudSource.slice(
      marker + '// Finally multiply by scattering.'.length,
      cloudSource.indexOf('#ifdef POWDER', marker)
    )
    const integral = cloudSource.slice(
      cloudSource.indexOf('float transmittance = exp(-media.extinction * stepSize);', marker),
      cloudSource.indexOf('// Aerial perspective affecting clouds', marker)
    )
    const shadowStep = shadowSource.slice(
      shadowSource.indexOf('extinctionSum += media.extinction;'),
      shadowSource.indexOf('++sampleCount;', shadowSource.indexOf('extinctionSum += media.extinction;'))
    )
    if (!multiply || !integral || !shadowStep) throw new Error('Missing integration shader anchors')
    const outputs: number[][] = [],
      shadows: number[][] = []
    for (const color of [
      [255, 0, 0],
      [0, 0, 255]
    ]) {
      const preparedColor = nearest(new DataTexture(new Uint8Array([...color, 255]), 1, 1, RGBAFormat))
      owned.add(preparedColor)
      // Only the prepared color texture differs; medium comes from the same mask.
      const uniforms = {
        cloudUseColorMap: { value: true },
        cloudColorTexture: { value: preparedColor },
        cloudConstantColor: { value: new Vector3(1, 1, 1) },
        cloudColorStrength: { value: 1 },
        cloudColorMipBias: { value: 0 },
        localWeatherTexture: { value: mask.weather }
      }
      outputs.push(
        gpu.run(
          `MediaSample media;media.extinction=texture2D(localWeatherTexture,vec2(.5)).r;media.scattering=media.extinction;vec2 uv=vec2(.5);float mipLevel=0.,stepSize=1.;vec3 radiance=vec3(1.),radianceIntegral=vec3(0.);float transmittanceIntegral=1.;${multiply}${integral}gl_FragColor=vec4(radianceIntegral,1.-transmittanceIntegral);`,
          'struct MediaSample{float scattering;float extinction;};uniform bool cloudUseColorMap;uniform sampler2D cloudColorTexture,localWeatherTexture;uniform vec3 cloudConstantColor;uniform float cloudColorStrength,cloudColorMipBias;',
          uniforms
        )
      )
      shadows.push(
        gpu.run(
          `MediaSample media;media.extinction=texture2D(localWeatherTexture,vec2(.5)).r;float extinctionSum=0.,maxOpticalDepth=0.,stepSize=1.,transmittanceIntegral=1.,weightedDistanceSum=0.,transmittanceSum=0.,rayDistance=1.;${shadowStep}gl_FragColor=vec4(maxOpticalDepth,transmittanceIntegral,extinctionSum,1.);`,
          'struct MediaSample{float extinction;};uniform sampler2D localWeatherTexture;',
          uniforms
        )
      )
    }
    const alpha = 1 - Math.exp(-64 / 255)
    check(outputs[0], [alpha, 0, 0, alpha], 'red cloud radiance')
    check(outputs[1], [0, 0, alpha, alpha], 'blue cloud radiance')
    check([outputs[1][3]], [outputs[0][3]], 'color-independent alpha')
    check(shadows[0], [64 / 255, Math.exp(-64 / 255), 64 / 255, 1], 'shadow/extinction numeric values')
    check(shadows[1], shadows[0], 'color-independent shadow/extinction')
  } finally {
    binding?.dispose()
    maps.forEach((map) => {
      map.dispose()
      map.dispose()
    })
    owned.forEach((texture) => texture.dispose())
    clouds.dispose()
    report.resourcesReleased = gpu.dispose()
  }
  if (!report.resourcesReleased) throw new Error('Earth probe resources leaked')
  return report
}
