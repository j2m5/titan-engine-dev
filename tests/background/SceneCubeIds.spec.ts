import { describe, it, expect } from 'vitest'
import { sceneCubeIds } from '@/core/services/ResourceObserver'

describe('кубмапа сценария грузится только в режиме cubemap', () => {
  it('gaia — ничего: 288 МБ впустую не грузятся', () => {
    expect(sceneCubeIds([1, 2, 3, 4, 5, 6], 'gaia')).toEqual([])
  })

  it('cubemap — кубмапа сценария', () => {
    expect(sceneCubeIds([1, 2, 3, 4, 5, 6], 'cubemap')).toEqual([1, 2, 3, 4, 5, 6])
  })
})
