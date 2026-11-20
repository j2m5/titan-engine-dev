import { describe, expect, it } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import { Matrix4, PerspectiveCamera, Quaternion, Vector3, type WebGLRenderer } from 'three'
import { bindSceneCloudReprojection } from '@/core/clouds/takram/sceneCloudReprojection'

const z = new Vector3(0, 0, 1)
const turn = (angle: number) => new Quaternion().setFromAxisAngle(z, angle)

function fixture() {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000)
  camera.position.z = 10
  camera.updateMatrixWorld(true)
  const clouds = new CloudsEffect(camera)
  clouds.cloudsPass.temporalUpscale = false
  clouds.cloudsPass.currentMaterial.setSize(16, 16)
  clouds.shadow.cascadeCount = 1
  const material = clouds.cloudsPass.currentMaterial
  const shadow = clouds.shadowPass
  shadow.setSize(8, 8, 1)
  const hooks = [
    material.copyCameraSettings,
    material.copyReprojectionMatrix,
    material.setSize,
    shadow.update,
    shadow.setSize
  ]
  // Replace only GPU draws; real shadow copying, swapping and commit ordering run.
  const renderCurrent = shadow.currentPass.render,
    renderResolve = shadow.resolvePass.render
  shadow.currentPass.render = () => {}
  shadow.resolvePass.render = () => {}
  clouds.shadowMaps.cascades[0].matrix.identity()
  clouds.shadowMaps.cascades[0].inverseMatrix.identity()
  const binding = bindSceneCloudReprojection(clouds)
  const point = new Vector3(1, 0, 0)
  const projected = () =>
    point.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(binding.viewReprojection.value)
  const expected = (world: Vector3) => world.clone().applyMatrix4(material.uniforms.reprojectionMatrix.value)
  const commit = (rotation = new Quaternion()) => {
    binding.setPlanetRotation(rotation)
    material.copyCameraSettings(camera)
    material.copyReprojectionMatrix(camera)
  }
  const updateShadow = () => shadow.update({} as WebGLRenderer, 2, 0)
  const shadowPoint = () => point.clone().applyMatrix4(binding.shadowReprojection.value[0])
  const dispose = () => {
    binding.dispose()
    shadow.currentPass.render = renderCurrent
    shadow.resolvePass.render = renderResolve
    clouds.dispose()
  }
  return {
    camera,
    clouds,
    material,
    shadow,
    hooks,
    binding,
    projected,
    expected,
    commit,
    updateShadow,
    shadowPoint,
    dispose
  }
}

function close(actual: Vector3, expected: Vector3) {
  expect(actual.distanceTo(expected)).toBeLessThan(1e-9)
}

describe('scene cloud rotation history', () => {
  it('uses the current pose on the first frame, then follows the same planet-fixed feature', () => {
    const f = fixture()
    try {
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(1, 0, 0)))
      f.commit()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(0, -1, 0)))
    } finally {
      f.dispose()
    }
  })

  it('does not consume motion during warmup copies or rotations that were never rendered', () => {
    const f = fixture()
    try {
      f.commit()
      f.binding.setPlanetRotation(turn(Math.PI / 4))
      f.material.copyCameraSettings(f.camera)
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      for (let i = 0; i < 3; i++) {
        f.material.copyCameraSettings(f.camera)
        close(f.projected(), f.expected(new Vector3(0, -1, 0)))
      }
      f.material.copyReprojectionMatrix(f.camera)
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(1, 0, 0)))
    } finally {
      f.dispose()
    }
  })

  it('composes noncommuting tilted rotations in the correct order', () => {
    const f = fixture()
    try {
      const previous = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
      f.commit(previous)
      f.binding.setPlanetRotation(previous.clone().multiply(turn(Math.PI / 2)))
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(0, 0, -1)))
    } finally {
      f.dispose()
    }
  })

  it('copies and normalizes input orientations, treating quaternion sign flips as the same pose', () => {
    const f = fixture()
    try {
      const rotation = turn(Math.PI / 2)
      f.commit(rotation)
      rotation.identity()
      const same = turn(Math.PI / 2)
      same.set(-same.x * 3, -same.y * 3, -same.z * 3, -same.w * 3)
      f.binding.setPlanetRotation(same)
      same.identity()
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(1, 0, 0)))
    } finally {
      f.dispose()
    }
  })

  it('keeps clear-ray camera matrices intact while cloud hits include planet motion', () => {
    const f = fixture()
    try {
      f.commit()
      const oldCamera = f.material.uniforms.viewReprojectionMatrix.value.clone()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.material.copyCameraSettings(f.camera)
      expect(f.material.uniforms.viewReprojectionMatrix.value.equals(oldCamera)).toBe(true)
      close(f.projected(), f.expected(new Vector3(0, -1, 0)))
    } finally {
      f.dispose()
    }
  })

  it('keeps cloud and shadow history commits independent and leaves vendor shadow matrices intact', () => {
    const f = fixture()
    try {
      f.updateShadow()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(0, -1, 0))
      expect(f.shadow.currentMaterial.uniforms.reprojectionMatrices.value[0].equals(new Matrix4())).toBe(true)
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(1, 0, 0)))
      f.commit(turn(Math.PI / 2))
      f.binding.setPlanetRotation(turn(Math.PI))
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(0, -1, 0)))
      // Cloud commit must not consume the pending shadow rotation.
      f.material.copyReprojectionMatrix(f.camera)
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(0, -1, 0))
    } finally {
      f.dispose()
    }
  })

  it('does not advance shadow orientation when its draw fails', () => {
    const f = fixture()
    try {
      f.updateShadow()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.shadow.currentPass.render = () => {
        throw new Error('failed GPU draw')
      }
      expect(f.updateShadow).toThrow('failed GPU draw')
      f.shadow.currentPass.render = () => {}
      f.binding.setPlanetRotation(turn(Math.PI))
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(-1, 0, 0))
    } finally {
      f.dispose()
    }
  })

  it('drops only the resized pass orientation and bootstraps temporal shadows when re-enabled', () => {
    const f = fixture()
    try {
      f.commit()
      f.updateShadow()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.material.setSize(32, 32)
      f.material.copyCameraSettings(f.camera)
      close(f.projected(), f.expected(new Vector3(1, 0, 0)))
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(0, -1, 0))
      f.binding.setPlanetRotation(turn(Math.PI))
      f.shadow.setSize(16, 16, 1)
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(1, 0, 0))
      f.shadow.temporalPass = false
      f.updateShadow()
      f.binding.setPlanetRotation(turn(0))
      f.shadow.temporalPass = true
      f.updateShadow()
      close(f.shadowPoint(), new Vector3(1, 0, 0))
    } finally {
      f.dispose()
    }
  })

  it('restores prior instance hooks on disposal without affecting another effect', () => {
    const f = fixture(),
      other = fixture()
    try {
      f.commit()
      f.binding.setPlanetRotation(turn(Math.PI / 2))
      f.material.copyCameraSettings(f.camera)
      other.material.copyCameraSettings(other.camera)
      close(other.projected(), other.expected(new Vector3(1, 0, 0)))
      f.binding.dispose()
      f.binding.dispose()
      expect([
        f.material.copyCameraSettings,
        f.material.copyReprojectionMatrix,
        f.material.setSize,
        f.shadow.update,
        f.shadow.setSize
      ]).toEqual(f.hooks)
    } finally {
      f.dispose()
      other.dispose()
    }
  })
})
