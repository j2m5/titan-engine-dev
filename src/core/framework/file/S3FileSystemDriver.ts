import { FileSystemDriver } from '@/core/framework/file/FileSystemDriver'
import { config } from '@/core/framework/config'

class S3FileSystemDriver implements FileSystemDriver {
  public get(filename: string): string {
    return `${config('disks.s3.url')}/${config('disks.s3.bucket')}/${filename}`
  }
}

export { S3FileSystemDriver }
