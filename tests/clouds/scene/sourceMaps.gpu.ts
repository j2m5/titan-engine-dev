import {
  DataTexture,
  Texture,
  SRGBColorSpace,
  NearestFilter,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Vector2,
  Vector3,
  Matrix3,
  Matrix4,
  Quaternion
} from 'three'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import { Storage } from '@/core/framework/file/Storage'
import { prepareRgbCloudTextures } from '@/core/clouds/appearance/rgbCloudTextures'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { CloudSources } from '@/core/clouds/CloudSources'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { createGpuReadback } from '../earth/gpuTestHarness'
import type { SceneCloudProbeReport } from './probe'

export async function run(): Promise<SceneCloudProbeReport> {
  const gpu = createGpuReadback()
  const report: SceneCloudProbeReport = { name: 'maps', checks: 0, maxError: 0, resourcesReleased: false, cases: [] }
  const owned: Texture[] = []
  const prepared: ReturnType<typeof prepareRgbCloudTextures>[] = []
  const bitmaps: ImageBitmap[] = []
  let url = ''
  let watcher: CloudSources | undefined
  const originalUrl = Storage.url
  const check = (actual: number, expected: number, label: string) => {
    const error = Math.abs(actual - expected)
    if (!Number.isFinite(error) || error > 2 / 255) throw new Error(`${label}: ${actual} != ${expected}`)
    report.maxError = Math.max(report.maxError, error)
    report.checks++
  }
  const sampler = (texture: Texture) => {
    texture.minFilter = texture.magFilter = NearestFilter
    texture.wrapS = RepeatWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }
  const read = (texture: Texture, uv: Vector2, coverage: boolean) =>
    gpu.run(
      `vec3 c=texture2D(map,uv).rgb;gl_FragColor=vec4(vec3(${coverage ? 'sqrt(dot(c,vec3(1./3.)))' : 'c.r'}),1.);`,
      'uniform sampler2D map;uniform vec2 uv;',
      { map: { value: texture }, uv: { value: uv } }
    )[0]
  try {
    // PNG top rows: black/white; red/gray. The real strategy preflips its bitmap during decode.
    const bytes = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 64, 64, 64, 255])
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    canvas.getContext('2d')!.putImageData(new ImageData(bytes, 2, 2), 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('PNG encoding failed'))), 'image/png')
    )
    url = URL.createObjectURL(blob)
    // URL routing only: load() still executes Three's ImageBitmapLoader and real createImageBitmap.
    Storage.url = () => url
    const bitmap = await ImageBitmapStrategy.create().load({
      paths: ['asymmetric.png'],
      name: 'asymmetric',
      params: {},
      resourceType: 'cloud'
    })
    Storage.url = originalUrl
    if (!(bitmap.image instanceof ImageBitmap)) throw new Error('Strategy did not produce a live ImageBitmap')
    bitmaps.push(bitmap.image)
    owned.push(bitmap)
    const html = new Image()
    html.src = url
    await html.decode()
    const data = new DataTexture(new Uint8Array(bytes), 2, 2)
    data.flipY = true
    const sources = [bitmap, new Texture(html), data]
    owned.push(...sources.slice(1))
    const points = [new Vector2(0.25, 0.25), new Vector2(0.75, 0.25), new Vector2(0.25, 0.75), new Vector2(0.75, 0.75)]
    const expected = [Math.sqrt(1 / 3), 0.2264262, 0, 1]
    for (let i = 0; i < sources.length; i++) {
      const source = sampler(sources[i])
      source.colorSpace = SRGBColorSpace
      const before = [
        source.colorSpace,
        source.wrapS,
        source.wrapT,
        source.flipY,
        source.version,
        source.source.version
      ]
      let disposals = 0
      source.addEventListener('dispose', () => disposals++)
      const maps = prepareRgbCloudTextures(source)
      prepared.push(maps)
      sampler(maps.weather)
      for (let j = 0; j < points.length; j++) {
        check(read(source, points[j], true), expected[j], `original-${i}-${j}`)
        check(read(maps.weather, points[j], false), expected[j], `prepared-${i}-${j}`)
      }
      for (const uv of [new Vector2(-0.25, 0.25), new Vector2(1.25, 0.75)])
        check(read(maps.weather, uv, false), read(source, uv, true), `seam-${i}`)
      for (const uv of [new Vector2(0.25, 0), new Vector2(0.75, 1)])
        check(read(maps.weather, uv, false), read(source, uv, true), `pole-${i}`)
      // A body-space 90-degree inverse rotation shifts a +Z world point to -X (u=.25).
      const inverse = new Matrix3().setFromMatrix4(
        new Matrix4().makeRotationFromQuaternion(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).invert()
        )
      )
      const actual = gpu.run(
        'vec3 p=normalize(inverseBody*point);vec2 q=vec2(atan(p.z,p.x)/(2.*3.141592653589793)+.5,asin(p.y)/3.141592653589793+.5);gl_FragColor=vec4(vec3(texture2D(map,q).r),1.);',
        'uniform sampler2D map;uniform mat3 inverseBody;uniform vec3 point;',
        { map: { value: maps.weather }, inverseBody: { value: inverse }, point: { value: new Vector3(0, 0.8, 1) } }
      )[0]
      const local = new Vector3(0, 0.8, 1).applyMatrix3(inverse).normalize()
      const uv = new Vector2(Math.atan2(local.z, local.x) / (2 * Math.PI) + 0.5, Math.asin(local.y) / Math.PI + 0.5)
      check(actual, read(source, uv, true), `rotation-${i}`)
      maps.dispose()
      maps.dispose()
      if (
        disposals ||
        JSON.stringify(before) !==
          JSON.stringify([
            source.colorSpace,
            source.wrapS,
            source.wrapT,
            source.flipY,
            source.version,
            source.source.version
          ])
      )
        throw new Error('Preparation mutated or disposed a borrowed original')
    }
    report.cases.push(
      'bitmap-corners',
      'html-corners',
      'data-corners',
      'seam',
      'poles',
      'body-rotation',
      'borrowed-ownership'
    )
    const wide = new DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1)
    owned.push(wide)
    const reduced = prepareRgbCloudTextures(wide, { maxWidth: 1 })
    prepared.push(reduced)
    check((reduced.weather.image.data as Uint8Array)[0] / 255, 0.5, 'decode-before-reduce')
    report.cases.push('decode-before-reduce')
    bitmap.name = 'scene-gpu-bitmap'
    resourceStorage.addTexture(bitmap)
    let invalidations = 0
    watcher = new CloudSources(new Map([[32, bitmap.name]]), () => {
      invalidations++
    })
    watcher.read(32)
    const replacement = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
    bitmaps.push(replacement)
    bitmap.image = replacement
    if (!watcher.poll() || invalidations !== 1 || watcher.read(32)?.image !== replacement)
      throw new Error('Bitmap replacement did not invalidate')
    const config = createJupiterCloudProfile()
    const appearance = prepareCloudSource(config, () => bitmap)
    appearance.dispose()
    check(invalidations, 1, 'replacement-and-independent-source')
    report.cases.push('bitmap-replacement')
  } finally {
    Storage.url = originalUrl
    watcher?.dispose()
    prepared.forEach((m) => m.dispose())
    if (resourceStorage.getTexture('scene-gpu-bitmap')) resourceStorage.deleteTexture('scene-gpu-bitmap')
    owned.filter((t) => t.name !== 'scene-gpu-bitmap').forEach((t) => t.dispose())
    bitmaps.forEach((b) => b.close())
    if (url) URL.revokeObjectURL(url)
    report.resourcesReleased = gpu.dispose()
  }
  return report
}
