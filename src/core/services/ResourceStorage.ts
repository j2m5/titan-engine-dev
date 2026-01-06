import { IResource } from '@/core/models/types'

export type ResourceDriverType = 'default' | 'cube' | 'bitmap' | 'compressed'

export interface ResourceGroup {
  actorId: number | null
  resources: IResource[]
  loadedAt: string
  expiredAt: string
}

class ResourceStorage {
  public keepingTime: number = 60000
}

export { ResourceStorage }
