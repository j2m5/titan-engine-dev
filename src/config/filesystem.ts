export type FileSystemDrivers = 'local' | 's3'

export type DiskParams = {
  url: string
  bucket?: string
}

export type DiskConfig = Record<FileSystemDrivers, DiskParams>

export interface FileSystemConfig {
  driver: FileSystemDrivers
  disks: DiskConfig
}

export const filesystem: FileSystemConfig = {
  driver: import.meta.env.VITE_FS_DRIVER,
  disks: {
    local: {
      url: '/images',
      bucket: import.meta.env.VITE_FILE_BUCKET
    },
    s3: {
      url: import.meta.env.VITE_S3_URL,
      bucket: import.meta.env.VITE_FILE_BUCKET
    }
  }
}
