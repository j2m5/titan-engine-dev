import { FileSystemDrivers } from '@/config/filesystem'
import { config } from '@/core/framework/config'
import { S3FileSystemDriver } from '@/core/framework/file/S3FileSystemDriver'
import { LocalFileSystemDriver } from '@/core/framework/file/LocalFileSystemDriver'

class Storage {
  private static driver: FileSystemDrivers = config('driver')

  public static disk(driver: FileSystemDrivers): Storage {
    return (this.driver = driver)
  }

  public static url(filename: string): string {
    switch (this.driver) {
      case 's3':
        return new S3FileSystemDriver().get(filename)
      default:
        return new LocalFileSystemDriver().get(filename)
    }
  }
}

export { Storage }
