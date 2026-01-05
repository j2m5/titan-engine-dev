import { FileSystemDriver } from '@/core/framework/file/FileSystemDriver'
import { config } from '@/core/framework/config'

class LocalFileSystemDriver implements FileSystemDriver {
  public get(filename: string): string {
    return `${config('disks.local.url')}/${config('disks.local.bucket')}/${filename}`
  }
}

export { LocalFileSystemDriver }
