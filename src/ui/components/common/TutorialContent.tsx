import { FC, ReactNode } from 'react'
import TitanLabel from '@titanui/components/TitanLabel'
import TitanDivider from '@titanui/components/TitanDivider'
import {
  ArrowsClockwiseIcon,
  ClockClockwiseIcon,
  CrosshairIcon,
  FastForwardIcon,
  GearIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  QuestionIcon,
  RewindIcon,
  RocketLaunchIcon,
  SignOutIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerSimpleHighIcon
} from '@phosphor-icons/react'

/** Иконка в строке текста — та же, что на кнопке в интерфейсе */
const Glyph: FC<{ children: ReactNode }> = ({ children }) => (
  <span style={{ display: 'inline-flex', verticalAlign: '-3px', margin: '0 2px' }}>{children}</span>
)

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <div>
    <TitanLabel>{title}</TitanLabel>
    <TitanDivider offsetTop={6} offsetBottom={6} />
    <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>{children}</ul>
  </div>
)

const ICON_SIZE: number = 16

/** Справка по управлению — сверена с текущим интерфейсом (AstroControls, ObjectList, TimeSpeed, MainAppBar) */
const TutorialContent = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
      <Section title="Camera">
        <li>
          <b>W</b> / <b>S</b> — forward / back, <b>A</b> / <b>D</b> — left / right, <b>R</b> / <b>F</b> — up / down
        </li>
        <li>
          <b>Arrow keys</b> — pitch and yaw, <b>Q</b> / <b>E</b> — roll
        </li>
        <li>
          Hold the <b>right mouse button</b> and drag to orbit the camera. Close to a surface it switches to free look
        </li>
        <li>
          <b>Mouse wheel</b> — camera speed (shown at the bottom left). The
          <Glyph>
            <SkipBackIcon size={ICON_SIZE} />
          </Glyph>
          /
          <Glyph>
            <SkipForwardIcon size={ICON_SIZE} />
          </Glyph>
          buttons next to it jump to the minimum / maximum speed
        </li>
      </Section>

      <Section title="Objects">
        <li>
          Click an object in the list on the right, the object itself or its marker in the scene to select it. Click
          empty space to clear the selection
        </li>
        <li>
          <Glyph>
            <RocketLaunchIcon size={ICON_SIZE} />
          </Glyph>
          — fly to the object
        </li>
        <li>
          <Glyph>
            <CrosshairIcon size={ICON_SIZE} />
          </Glyph>
          — follow the object as it moves. Click again to stop following
        </li>
      </Section>

      <Section title="Time">
        <li>The top bar shows the simulation date, time and speed</li>
        <li>
          <Glyph>
            <RewindIcon size={ICON_SIZE} />
          </Glyph>
          /
          <Glyph>
            <FastForwardIcon size={ICON_SIZE} />
          </Glyph>
          — slow down / speed up time, from a pause up to 10,000,000x
        </li>
        <li>
          <Glyph>
            <PauseIcon size={ICON_SIZE} />
          </Glyph>
          /
          <Glyph>
            <PlayIcon size={ICON_SIZE} />
          </Glyph>
          — pause / resume
        </li>
        <li>
          <Glyph>
            <ArrowsClockwiseIcon size={ICON_SIZE} />
          </Glyph>
          — back to real time (1x),
          <Glyph>
            <ClockClockwiseIcon size={ICON_SIZE} />
          </Glyph>
          — reset the date to now
        </li>
      </Section>

      <Section title="Top bar">
        <li>
          <Glyph>
            <QuestionIcon size={ICON_SIZE} />
          </Glyph>
          — this help
        </li>
        <li>
          <Glyph>
            <SpeakerSimpleHighIcon size={ICON_SIZE} />
          </Glyph>
          — audio player. You can add your own MP3, WAV or OGG tracks
        </li>
        <li>
          <Glyph>
            <GearIcon size={ICON_SIZE} />
          </Glyph>
          — settings: orbit lines and object markers
        </li>
        <li>
          <Glyph>
            <ImageIcon size={ICON_SIZE} />
          </Glyph>
          — save a 4K screenshot of the current view to your downloads
        </li>
        <li>
          <Glyph>
            <SignOutIcon size={ICON_SIZE} />
          </Glyph>
          — back to the scenario list
        </li>
      </Section>
    </div>
  )
}

export default TutorialContent
