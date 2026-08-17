import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import { CameraController } from '@/core/camera/CameraController'
import { cameraStore } from '@/ui/mobx/CameraStore'

describe('CameraStore: toggle позиционного слежения', () => {
  it('зеркалит включение, честное переключение цели и повторное отключение', () => {
    const controller = new CameraController()
    const first = new Object3D()
    const second = new Object3D()

    cameraStore.connect(controller)

    cameraStore.toggleFollow(first)
    expect(cameraStore.currentTarget).toBe(first)

    cameraStore.toggleFollow(second)
    expect(cameraStore.currentTarget).toBe(second)

    cameraStore.toggleFollow(second)
    expect(cameraStore.currentTarget).toBeNull()
  })
})
