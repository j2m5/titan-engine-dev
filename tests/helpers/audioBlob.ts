/** Small real PCM WAV with a RIFF INFO title for metadata parser tests. */
export function audioBlob(): Blob {
  const bytes = new Uint8Array(80)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => {
    bytes.set(new TextEncoder().encode(value), offset)
  }
  text(0, 'RIFF')
  view.setUint32(4, 72, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'LIST')
  view.setUint32(40, 28, true)
  text(44, 'INFOINAM')
  view.setUint32(52, 15, true)
  text(56, 'Metadata title\0')
  text(72, 'data')
  return new Blob([bytes], { type: 'audio/wav' })
}
