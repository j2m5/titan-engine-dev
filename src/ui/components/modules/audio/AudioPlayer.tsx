import { ChangeEvent, ReactEventHandler, useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { AudioPlayerProps } from '@/ui/components/modules/audio/interfaces/AudioPlayerProps'
import { Box, Button, Divider, IconButton, Slider, Stack, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import ReplayIcon from '@mui/icons-material/Replay'
import AddIcon from '@mui/icons-material/Add'
import { VolumeDownRounded, VolumeUpRounded } from '@mui/icons-material'
import AudioProgressBar from '@/ui/components/modules/audio/AudioProgressBar'
import TrackList from '@/ui/components/modules/audio/TrackList'
import { audioPlayerStore } from '@/ui/mobX/AudioPlayerStore'
import { styled } from '@mui/material/styles'
import { ITrack } from '@/ui/components/modules/audio/interfaces/ITrack'

const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0,
  whiteSpace: 'nowrap',
  width: 1
})

const AudioPlayer = observer((props: AudioPlayerProps) => {
  const { currentTrack, trackIndex, trackCount, onPlay, onNext, onPrev } = props

  const tracks: ITrack[] = audioPlayerStore.tracks
  const cachedVolume: number = Number(sessionStorage.getItem('volume'))
  const defaultVolume: number = cachedVolume || 0.1

  const audioRef = useRef<HTMLAudioElement | null>(null)

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
    if (files) {
      const file: File = files[0]
      const title: string = file.name
      const src: string = URL.createObjectURL(file)

      const newTrack: { title: string; src: string } = { title, src }

      await audioPlayerStore.add(newTrack)
    }
  }

  return (
    <Box display="flex" flexDirection="column" alignItems="center" sx={{ width: '500px' }}>
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
      <Box textAlign="center" sx={{ height: '45px' }}>
        <Typography variant="caption">
          {currentTrack?.metadata?.title ?? currentTrack?.title ?? 'Select a track'}
          {currentTrack && ` - ${currentTrack.metadata?.artist}`}
        </Typography>
        {currentTrack && <Typography variant="body2">{currentTrack?.metadata?.album}</Typography>}
      </Box>
      <Box sx={{ width: '100%' }}>
        <Box>
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
        </Box>
        <Box display="flex" justifyContent="center">
          <IconButton disabled={!isReady || trackIndex === 0} onClick={handlePrev}>
            <SkipPreviousIcon />
          </IconButton>
          <IconButton disabled={!isReady} onClick={togglePlayPause}>
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <IconButton disabled={!isReady || trackIndex === trackCount - 1} onClick={handleNext}>
            <SkipNextIcon />
          </IconButton>
          <IconButton disabled={!isReady || trackIndex === -1} onClick={handleLoop}>
            <ReplayIcon color={loop ? 'action' : 'disabled'} />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ width: '50%' }}>
        <Stack spacing={2} direction="row" alignItems="center">
          <IconButton onClick={() => handleVolumeChange(0)}>
            <VolumeDownRounded />
          </IconButton>
          <Slider
            size="small"
            value={volume}
            step={0.01}
            min={0}
            max={1}
            onChange={(event: Event, value: number | number[]) => handleVolumeChange(Number(value))}
          />
          <IconButton onClick={() => handleVolumeChange(1)}>
            <VolumeUpRounded />
          </IconButton>
        </Stack>
      </Box>
      <Divider sx={{ width: '100%', padding: '5px 0' }} />
      <Box display="flex" alignSelf="start" sx={{ width: '100%' }}>
        <TrackList
          data={tracks}
          isPlaying={isPlaying}
          currentTrackIndex={trackIndex}
          onPlay={handlePlay}
          onTogglePlaying={togglePlayPause}
        />
      </Box>
      <Divider sx={{ width: '100%', padding: '5px 0' }} />
      <Box sx={{ padding: '10px 0 0' }}>
        <Button component="label" role={undefined} tabIndex={-1} variant="outlined" startIcon={<AddIcon />}>
          Add a track
          <VisuallyHiddenInput type="file" onChange={(event) => handleAddTrack(event)} />
        </Button>
      </Box>
    </Box>
  )
})

export default AudioPlayer
