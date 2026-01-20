import { ChangeEvent, ReactEventHandler, useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'
import { AudioPlayerProps } from '@/ui/components/modules/audio/interfaces/AudioPlayerProps'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanLabel from '@/ui/TitanUI/components/TitanLabel'
import TitanSlider from '@/ui/TitanUI/components/TitanSlider'
import TitanDivider from '@/ui/TitanUI/components/TitanDivider'
import TitanButton from '@/ui/TitanUI/components/TitanButton'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import AudioProgressBar from '@/ui/components/modules/audio/AudioProgressBar'
import TrackList from '@/ui/components/modules/audio/TrackList'
import {
  SkipBackIcon,
  PauseIcon,
  PlayIcon,
  SkipForwardIcon,
  ArrowsClockwiseIcon,
  SpeakerSimpleLowIcon,
  SpeakerSimpleHighIcon,
  PlusIcon
} from '@phosphor-icons/react'
import { audioPlayerStore } from '@/ui/mobX/AudioPlayerStore'
import { notificationStore } from '@/ui/mobX/NotificationStore'

const AudioPlayer = observer((props: AudioPlayerProps) => {
  const { currentTrack, trackIndex, trackCount, onPlay, onNext, onPrev } = props

  const tracks: ITrack[] = audioPlayerStore.tracks
  const cachedVolume: number = Number(sessionStorage.getItem('volume'))
  const defaultVolume: number = cachedVolume || 0.1

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [duration, setDuration] = useState(0)
  const [currentProgress, setCurrentProgress] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(defaultVolume)
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)

  useEffect(() => {
    audioRef.current?.pause()

    const timeout = setTimeout(() => {
      audioRef.current?.play()
    }, 50)

    return (): void => {
      clearTimeout(timeout)
    }
  }, [trackIndex])

  const handlePlay = (index: number): void => {
    onPlay(index)
  }

  const handleNext = (): void => {
    onNext()
  }

  const handlePrev = (): void => {
    onPrev()
  }

  const handleLoop = (): void => {
    if (loop) {
      setLoop(false)
    } else {
      setLoop(true)
    }
  }

  const togglePlayPause = (): void => {
    if (isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false)
    } else {
      audioRef.current?.play()
      setIsPlaying(true)
    }
  }

  const handleBufferProgress: ReactEventHandler<HTMLAudioElement> = (event) => {
    const audio = event.currentTarget
    const dur: number = audio.duration
    if (dur > 0) {
      for (let i: number = 0; i < audio.buffered.length; i++) {
        if (audio.buffered.start(audio.buffered.length - 1 - i) < audio.currentTime) {
          const bufferedLength = audio.buffered.end(audio.buffered.length - 1 - i)
          setBuffered(bufferedLength)
          break
        }
      }
    }
  }

  const handleVolumeChange = (value: number): void => {
    if (!audioRef.current) return

    audioRef.current.volume = value
    setVolume(value)
    sessionStorage.setItem('volume', `${value}`)
  }

  const handleAddTrack = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files: FileList | null = event.target.files
    const allowedTypes: string[] = ['audio/mpeg', 'audio/wav', 'audio/ogg']
    if (files) {
      const file: File = files[0]

      if (!allowedTypes.includes(file.type)) {
        notificationStore.openNotification({ type: 'error', message: 'Unsupported file type (Supports MP3, WAV, OGG)' })

        return
      }

      const title: string = file.name
      const src: string = URL.createObjectURL(file)

      const newTrack: { title: string; src: string } = { title, src }

      await audioPlayerStore.add(newTrack)
    }
  }

  const handleClickAdd = () => {
    if (fileRef.current) {
      fileRef.current.click()
    }
  }

  return (
    <div style={{ width: '500px' }}>
      <TitanFlex justify="center" width="100%" style={{ margin: '10px 0' }}>
        {currentTrack && (
          <audio
            ref={audioRef}
            preload="metadata"
            loop={loop}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onPlaying={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={handleNext}
            onCanPlay={(event) => {
              event.currentTarget.volume = volume
              setIsReady(true)
            }}
            onTimeUpdate={(event) => {
              setCurrentProgress(event.currentTarget.currentTime)
              handleBufferProgress(event)
            }}
            onProgress={handleBufferProgress}
            onVolumeChange={(event) => setVolume(event.currentTarget.volume)}
          >
            Your browser does not support the audio element
            <source type="audio/mpeg" src={currentTrack.src} />
          </audio>
        )}
      </TitanFlex>
      <TitanFlex justify="center" width="100%" style={{ margin: '0 0 30px', textAlign: 'center' }}>
        <TitanLabel>
          {currentTrack?.metadata?.title ?? currentTrack?.title ?? 'Select a track'}
          {currentTrack && ` - ${currentTrack.metadata?.artist}`}
        </TitanLabel>
      </TitanFlex>
      <TitanFlex justify="center" align="center" width="100%" style={{ gap: '10px' }}>
        <AudioProgressBar
          duration={duration}
          currentProgress={currentProgress}
          buffered={buffered}
          onProgressChanged={(event): void => {
            if (!audioRef.current) return

            audioRef.current.currentTime = event

            setCurrentProgress(event)
          }}
        />
      </TitanFlex>
      <TitanFlex justify="center" width="100%" style={{ margin: '10px 0 0' }}>
        <TitanIconButton disabled={!isReady || trackIndex === 0} onClick={handlePrev}>
          <SkipBackIcon size={20} />
        </TitanIconButton>
        <TitanIconButton disabled={!isReady} onClick={togglePlayPause}>
          {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
        </TitanIconButton>
        <TitanIconButton disabled={!isReady || trackIndex === trackCount - 1} onClick={handleNext}>
          <SkipForwardIcon size={20} />
        </TitanIconButton>
        <TitanIconButton disabled={!isReady || trackIndex === -1} onClick={handleLoop}>
          <ArrowsClockwiseIcon color={loop ? '#f0f0f0' : '#888888'} size={20} />
        </TitanIconButton>
      </TitanFlex>
      <TitanFlex justify="center" align="center" width="100%" style={{ margin: '0 0 10px' }}>
        <TitanIconButton onClick={() => handleVolumeChange(0)}>
          <SpeakerSimpleLowIcon size={20} />
        </TitanIconButton>
        <TitanSlider
          value={volume}
          step={0.01}
          min={0}
          max={1}
          style={{ width: '150px' }}
          onChange={(event: ChangeEvent<HTMLInputElement>) => handleVolumeChange(event.target.valueAsNumber)}
        />
        <TitanIconButton onClick={() => handleVolumeChange(1)}>
          <SpeakerSimpleHighIcon size={20} />
        </TitanIconButton>
      </TitanFlex>
      <TitanDivider />
      <TitanFlex>
        <TrackList
          data={tracks}
          isPlaying={isPlaying}
          currentTrackIndex={trackIndex}
          onPlay={handlePlay}
          onTogglePlaying={togglePlayPause}
        />
      </TitanFlex>
      <TitanDivider />
      <TitanFlex justify="center" width="100%">
        <input
          ref={fileRef}
          type="file"
          accept="audio/mp3,audio/wav,audio/ogg"
          style={{ display: 'none' }}
          onChange={(event: ChangeEvent<HTMLInputElement>) => handleAddTrack(event)}
        />
        <TitanButton onClick={handleClickAdd}>
          <PlusIcon size={20} /> Add a track
        </TitanButton>
      </TitanFlex>
    </div>
  )
})

export default AudioPlayer
