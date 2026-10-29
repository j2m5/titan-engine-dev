import type { CloudsEffect } from '@takram/three-clouds'
import { Matrix4, PerspectiveCamera, Quaternion, Vector2, Vector3, Vector4, type ShaderMaterial } from 'three'

/** Execute the installed cloud-hit velocity block with the real camera matrices.
 * The reference projects a physical world point on the CPU in double precision.
 */
export function checkSceneCloudReprojection(
  clouds: CloudsEffect,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const material = clouds.cloudsPass.currentMaterial
  const source = material.fragmentShader
  const kernel = source.match(
    /\/\/ Velocity for temporal resolution\.\s*([^]*?)depthVelocity = vec3\(frontDepth, velocity\);/
  )
  const toWorld = source.match(/vec3 ecefToWorld\([^]*?\n\}/)?.[0]
  if (!kernel || !toWorld) throw new Error('Missing installed cloud-hit reprojection')
  const fragment = `
uniform mat4 reprojectionMatrix, viewReprojectionMatrix, ecefToWorldMatrix;
uniform vec3 altitudeCorrection, fixtureOrigin, fixtureDirection, fixtureViewDirection;
uniform vec2 fixtureUv;
uniform float fixtureDistance;
${toWorld}
void main() {
  vec2 vUv = fixtureUv;
  vec3 vViewPosition = fixtureViewDirection;
  float frontDepth = fixtureDistance;
  vec3 frontPosition = fixtureOrigin + frontDepth * fixtureDirection;
  ${kernel[1]}
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`
  const normal = new Vector3(0.0877654, 0.832764, 0.546627).normalize()
  const tangent = new Vector3(0, 1, 0).addScaledVector(normal, -normal.y).normalize()
  const uv = new Vector2(0.31, 0.63)
  const originalFrame = material.uniforms.frame.value
  try {
    for (const radius of [0, 6367000, 69925000])
      for (const corrected of [false, true])
        for (const motion of ['stationary', 'translate', 'rotate'] as const) {
          const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1e9)
          camera.position.copy(normal).multiplyScalar(radius)
          camera.up.copy(normal)
          camera.lookAt(camera.position.clone().add(tangent))
          camera.updateMatrixWorld(true)
          const previous = camera.clone(false)
          if (motion === 'translate') previous.position.add(new Vector3(3, -2, 5))
          if (motion === 'rotate') previous.quaternion.premultiply(new Quaternion().setFromAxisAngle(normal, 0.002))
          previous.updateMatrixWorld(true)
          const toECEF = corrected ? new Matrix4().makeRotationY(0.37) : new Matrix4()
          const correction = corrected ? new Vector3(13, -27, 8) : new Vector3()
          const fromECEF = toECEF.clone().invert()
          for (const frame of [1, 8, 16]) {
            material.uniforms.frame.value = frame
            material.copyReprojectionMatrix(previous)
            material.copyCameraSettings(camera)
            const uniforms = material.uniforms
            const view = new Vector4(uv.x * 2 - 1, uv.y * 2 - 1, 0, 1).applyMatrix4(
              uniforms.inverseProjectionMatrix.value
            )
            const viewDirection = new Vector3(view.x, view.y, view.z)
            const worldDirection = viewDirection.clone().normalize().applyQuaternion(camera.quaternion)
            for (const distance of [10, 200, 2000000]) {
              const point = camera.position.clone().addScaledVector(worldDirection, distance)
              const projected = point.applyMatrix4(uniforms.reprojectionMatrix.value)
              const expected = new Vector2(uv.x - (projected.x * 0.5 + 0.5), uv.y - (projected.y * 0.5 + 0.5))
              if (motion === 'stationary') {
                check(expected.length() < 1e-7, 'stationary double-precision reference has zero velocity')
                expected.set(0, 0)
              }
              const actual = draw(fragment, {
                reprojectionMatrix: uniforms.reprojectionMatrix,
                viewReprojectionMatrix: uniforms.viewReprojectionMatrix,
                ecefToWorldMatrix: { value: fromECEF },
                altitudeCorrection: { value: correction },
                fixtureOrigin: { value: camera.position.clone().applyMatrix4(toECEF).add(correction) },
                fixtureDirection: { value: worldDirection.clone().transformDirection(toECEF) },
                fixtureViewDirection: { value: viewDirection },
                fixtureUv: { value: uv },
                fixtureDistance: { value: distance }
              })
              const errorPixels = Math.hypot((actual[0] - expected.x) * 1920, (actual[1] - expected.y) * 1080)
              check(
                actual.every(Number.isFinite) && errorPixels < 0.002,
                `cloud velocity ${motion}, radius ${radius}, distance ${distance}, frame ${frame}, corrected ${corrected}: ${errorPixels} pixels`
              )
            }
          }
        }
  } finally {
    material.uniforms.frame.value = originalFrame
    material.copyReprojectionMatrix(clouds.mainCamera)
    material.copyCameraSettings(clouds.mainCamera)
  }
}
