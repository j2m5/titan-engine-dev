import { CloudsEffect } from '@takram/three-clouds'
import {
  Euler,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  type ShaderMaterial,
  type WebGLRenderer
} from 'three'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import type { SceneCloudDepthFrame } from '@/core/graphic/clouds/SceneCloudDepth'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { installSceneCloudPatches } from '@/core/clouds/takram/sceneCloudLighting'

/** Execute installed hit-velocity kernels against a physical planet-fixed point.
 * The shadow pass keeps its real history lifecycle; only its two GPU draw calls
 * are replaced while this fixture supplies controlled light projection matrices.
 */
export function checkSceneCloudPlanetRotation(
  renderer: WebGLRenderer,
  frame: CloudFrame,
  depth: SceneCloudDepthFrame,
  atmosphere: AtmosphereEntry,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const clouds = new CloudsEffect(frame.camera)
  const binding = installSceneCloudPatches(clouds)
  const material = clouds.cloudsPass.currentMaterial
  const shadow = clouds.shadowPass
  const shadowCurrentRender = shadow.currentPass.render
  const shadowResolveRender = shadow.resolvePass.render
  const source = material.fragmentShader
  const kernel = source.match(
    /\/\/ Velocity for temporal resolution\.\s*([^]*?)depthVelocity = vec3\(frontDepth, velocity\);/
  )
  const toWorld = source.match(/vec3 ecefToWorld\([^]*?\n\}/)?.[0]
  const shadowKernel = shadow.currentMaterial.fragmentShader.match(
    /vec3 frontPositionWorld =[^]*?outputDepthVelocity = vec3\(color.x, velocity\);/
  )?.[0]
  check(!!kernel && !!toWorld && !!shadowKernel, 'installed cloud/shadow hit velocity kernels are present')
  const cloudFragment = `
uniform mat4 reprojectionMatrix, viewReprojectionMatrix, sceneCloudViewReprojectionMatrix, ecefToWorldMatrix;
uniform vec3 altitudeCorrection, fixtureOrigin, fixtureDirection, fixtureViewDirection;
uniform vec2 fixtureUv;
uniform float fixtureDistance;
${toWorld}
void main() {
  vec2 vUv = fixtureUv;
  vec3 vViewPosition = fixtureViewDirection;
  float frontDepth = fixtureDistance;
  vec3 frontPosition = fixtureOrigin + frontDepth * fixtureDirection;
  ${kernel?.[1]}
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`
  const shadowFragment = `
uniform mat4 reprojectionMatrices[4], sceneCloudShadowReprojectionMatrices[4], ecefToWorldMatrix;
uniform vec3 altitudeCorrection, fixturePoint;
uniform vec2 resolution, fixtureUv;
void main() {
  int cascadeIndex = 0;
  vec2 vUv = fixtureUv;
  vec3 frontPosition = fixturePoint;
  vec4 color = vec4(100.0, 1.0, 0.0, 0.0);
  vec3 outputDepthVelocity;
  ${shadowKernel}
  gl_FragColor = vec4(outputDepthVelocity.gb, 0.0, 1.0);
}`
  const period = 86164
  const spin = (2 * Math.PI) / (60 * period)
  const tilted = new Quaternion().setFromEuler(new Euler(0.4, -0.3, 0.2))
  const normal = new Vector3(0.0877654, 0.832764, 0.546627).normalize()
  const uv = new Vector2(0.5, 0.5)
  const update = (camera: PerspectiveCamera, rotation: Quaternion, radius: number): void => {
    binding.update({ ...frame, camera, planetRotation: rotation, datumRadiusMeters: radius }, depth, atmosphere)
  }
  const previousPoint = (point: Vector3, previous: Quaternion, current: Quaternion): Vector3 =>
    point.clone().applyQuaternion(current.clone().invert()).applyQuaternion(previous)
  try {
    for (const upscale of [false, true]) {
      material.temporalUpscale = upscale
      for (const fixture of [
        { label: 'stationary', radius: 6371000, distance: 10000, angle: 0, tilted: false, cameraMotion: false },
        { label: '1x spin', radius: 6371000, distance: 10000, angle: spin, tilted: false, cameraMotion: false },
        {
          label: '1000x spin',
          radius: 6371000,
          distance: 10000,
          angle: spin * 1000,
          tilted: false,
          cameraMotion: false
        },
        {
          label: 'tilted reverse spin',
          radius: 6371000,
          distance: 10000,
          angle: -spin * 1000,
          tilted: true,
          cameraMotion: false
        },
        { label: 'combined motion', radius: 6371000, distance: 10000, angle: spin, tilted: true, cameraMotion: true },
        { label: 'giant spin', radius: 69925000, distance: 10000, angle: spin, tilted: true, cameraMotion: false },
        {
          label: 'near Earth precision',
          radius: 6371000,
          distance: 10,
          angle: 1e-10,
          tilted: true,
          cameraMotion: false
        },
        {
          label: 'near giant precision',
          radius: 69925000,
          distance: 10,
          angle: 1e-10,
          tilted: true,
          cameraMotion: false
        }
      ]) {
        material.setSize(1920, 1080)
        material.uniforms.frame.value = 8
        const previous = new PerspectiveCamera(50, 1920 / 1080, 0.1, 1e9)
        previous.position.copy(normal).multiplyScalar(fixture.radius + fixture.distance)
        previous.lookAt(normal.clone().multiplyScalar(fixture.radius))
        previous.updateMatrixWorld(true)
        const camera = previous.clone(false)
        if (fixture.cameraMotion) {
          camera.position.add(new Vector3(3, -2, 5))
          camera.quaternion.premultiply(new Quaternion().setFromAxisAngle(normal, 0.002))
        }
        camera.updateMatrixWorld(true)
        const previousRotation = fixture.tilted ? tilted.clone() : new Quaternion()
        const rotation = previousRotation
          .clone()
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fixture.angle))
        update(previous, previousRotation, fixture.radius)
        material.copyCameraSettings(previous)
        material.copyReprojectionMatrix(previous)
        update(camera, rotation, fixture.radius)
        // Repeated camera copies also occur during shader warmup; neither may
        // consume the rotation delta before the current hit is rendered.
        material.copyCameraSettings(camera)
        material.copyCameraSettings(camera)
        const u = material.uniforms
        const view = new Vector4(0, 0, 0, 1).applyMatrix4(u.inverseProjectionMatrix.value)
        const viewDirection = new Vector3(view.x, view.y, view.z)
        const direction = viewDirection.clone().normalize().applyQuaternion(camera.quaternion)
        const point = camera.position.clone().addScaledVector(direction, fixture.distance)
        const projected = previousPoint(point, previousRotation, rotation).applyMatrix4(u.reprojectionMatrix.value)
        const expected = new Vector2(uv.x - (projected.x * 0.5 + 0.5), uv.y - (projected.y * 0.5 + 0.5))
        const actual = draw(cloudFragment, {
          reprojectionMatrix: u.reprojectionMatrix,
          viewReprojectionMatrix: u.viewReprojectionMatrix,
          ...(u.sceneCloudViewReprojectionMatrix
            ? { sceneCloudViewReprojectionMatrix: u.sceneCloudViewReprojectionMatrix }
            : {}),
          ecefToWorldMatrix: { value: new Matrix4() },
          altitudeCorrection: { value: new Vector3() },
          fixtureOrigin: { value: camera.position },
          fixtureDirection: { value: direction },
          fixtureViewDirection: { value: viewDirection },
          fixtureUv: { value: uv },
          fixtureDistance: { value: fixture.distance }
        })
        const error = Math.hypot((actual[0] - expected.x) * 1920, (actual[1] - expected.y) * 1080)
        check(
          actual.every(Number.isFinite) && error < 0.002,
          `planet ${fixture.label}, upscale=${upscale}: ${error} pixels; actual=${actual.slice(0, 2)}, expected=${expected.toArray()}`
        )
      }
    }
    shadow.currentPass.render = () => {}
    shadow.resolvePass.render = () => {}
    clouds.shadow.cascadeCount = 1
    for (const angle of [0, spin, spin * 1000, -spin * 1000]) {
      shadow.setSize(1024, 1024, 1)
      const point = new Vector3(6371000, 0, 0)
      const light = new OrthographicCamera(-1048576, 1048576, 1048576, -1048576, 1, 4000000)
      light.position.copy(point).add(new Vector3(0, 0, 1000000))
      light.lookAt(point)
      light.updateMatrixWorld(true)
      const projection = new Matrix4().multiplyMatrices(light.projectionMatrix, light.matrixWorldInverse)
      clouds.shadowMaps.cascades[0].matrix.copy(projection)
      clouds.shadowMaps.cascades[0].inverseMatrix.copy(projection).invert()
      const previousRotation = new Quaternion()
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle)
      update(frame.camera, previousRotation, 6371000)
      shadow.update(renderer, 1, 0)
      update(frame.camera, rotation, 6371000)
      shadow.update(renderer, 2, 0)
      const currentClip = point.clone().applyMatrix4(projection)
      const oldClip = previousPoint(point, previousRotation, rotation).applyMatrix4(projection)
      const currentUv = new Vector2(currentClip.x * 0.5 + 0.5, currentClip.y * 0.5 + 0.5)
      const expected = new Vector2((currentClip.x - oldClip.x) * 512, (currentClip.y - oldClip.y) * 512)
      const u = shadow.currentMaterial.uniforms
      const actual = draw(shadowFragment, {
        reprojectionMatrices: u.reprojectionMatrices,
        ...(u.sceneCloudShadowReprojectionMatrices
          ? { sceneCloudShadowReprojectionMatrices: u.sceneCloudShadowReprojectionMatrices }
          : {}),
        ecefToWorldMatrix: { value: new Matrix4() },
        altitudeCorrection: { value: new Vector3() },
        resolution: u.resolution,
        fixturePoint: { value: point },
        fixtureUv: { value: currentUv }
      })
      const error = Math.hypot(actual[0] - expected.x, actual[1] - expected.y)
      check(
        actual.every(Number.isFinite) && error < 0.01,
        `shadow planet spin=${angle}: ${error} pixels; actual=${actual.slice(0, 2)}, expected=${expected.toArray()}`
      )
    }
  } finally {
    shadow.currentPass.render = shadowCurrentRender
    shadow.resolvePass.render = shadowResolveRender
    binding.dispose()
    clouds.dispose()
  }
}
