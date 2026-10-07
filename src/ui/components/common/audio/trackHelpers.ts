import { ITrack } from '@/ui/types'

/**
 * Подпись трека: «название - исполнитель». Без разобранных метаданных
 * (fetchMetadata вернул трек как есть) или без исполнителя — только название:
 * иначе в плеере и списке висело «TITLE - undefined».
 */
export function trackLabel(track: ITrack): string {
  const title: string = track.metadata?.title || track.title
  const artist: string | undefined = track.metadata?.artist

  return artist ? `${title} - ${artist}` : title
}

/** Есть ли куда переключиться вперёд: на последнем треке плеер останавливается */
export function hasNextTrack(index: number, count: number): boolean {
  return index < count - 1
}
