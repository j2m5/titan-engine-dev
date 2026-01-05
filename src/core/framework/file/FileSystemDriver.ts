interface FileSystemDriver {
  get(filename: string): string
}

export type { FileSystemDriver }
