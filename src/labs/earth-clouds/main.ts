import './style.css'
import { EarthCloudLab, type EarthCloudLabStats } from './EarthCloudLab'
import { loadEarthTextures } from './earthAssets'
import { startEarthCloudSession } from './earthCloudSession'
import type { CloudView } from '@/labs/jupiter-clouds/CloudFlight'
import type { EarthCloudQuality } from './EarthCloudAdapter'

const root = document.querySelector<HTMLElement>('#earth-cloud-lab')!
function mount(): () => void {
  root.dataset.state = 'loading'
  for (const key of Object.keys(root.dataset)) if (key !== 'state') delete root.dataset[key]
  root.innerHTML = `
  <div class="cloud-viewport"></div>
  <section class="cloud-panel" aria-label="Управление облаками Земли">
    <a class="back-link" href="./">← TitanEngine</a>
    <p class="eyebrow">ЭКСПЕРИМЕНТ · 02</p>
    <h1>Земля<span>Объёмные облака</span></h1>
    <p class="description">С орбиты — карта облаков. При сближении — объёмный слой 4–8 км и тени на поверхности.</p>
    <div class="view-buttons" role="group" aria-label="Положение камеры">
      <button data-view="orbit" aria-pressed="true" disabled>Орбита</button>
      <button data-view="approach" aria-pressed="false" disabled>Переход</button>
      <button data-view="above" aria-pressed="false" disabled>Над облаками</button>
      <button data-view="inside" aria-pressed="false" disabled>Внутри слоя</button>
      <button data-view="below" aria-pressed="false" disabled>Под облаками</button>
    </div>
    <label class="control-row"><span>Облака</span><input id="clouds-enabled" type="checkbox" checked disabled /></label>
    <label class="control-row"><span>Качество</span><select id="quality" disabled>
      <option value="low">Низкое</option><option value="medium" selected>Среднее</option><option value="high">Высокое</option>
    </select></label>
    <p id="cloud-detail" class="detail-status">Подготовка объёма…</p>
    <label class="sun-control" for="sun-angle">Солнце <output id="sun-value">35°</output></label>
    <input id="sun-angle" type="range" min="-180" max="180" value="35" step="1" disabled />
    <div class="telemetry"><span>Высота <b id="altitude">—</b></span><span>Кадр <b id="frame-time">—</b></span></div>
    <p class="flight-help">Перетаскивание — обзор · WASD — полёт<br>Q/E — вниз/вверх · Shift — быстрее · Колесо — вперёд/назад</p>
    <p class="credits">Облака: Takram · Атмосфера и LUT: TitanEngine</p>
  </section>
  <div class="cloud-status" role="status">Загрузка карт Земли…</div>
`
  const status = root.querySelector<HTMLElement>('.cloud-status')!
  const abort = new AbortController()
  const events = { signal: abort.signal }
  let lab: EarthCloudLab | undefined
  let disposed = false
  let failed = false
  let session: ReturnType<typeof startEarthCloudSession> | undefined

  function fail(error: Error): void {
    if (disposed) return
    failed = true
    status.hidden = false
    status.textContent = error.message
    status.setAttribute('role', 'alert')
    root.dataset.state = 'error'
    console.error(error)
  }
  function publish(stats: EarthCloudLabStats): void {
    if (disposed || failed) return
    root.dataset.state = 'ready'
    for (const key of [
      'altitudeKm',
      'volumeWeight',
      'frames',
      'cloudFrames',
      'shadowFrames',
      'farFrames',
      'nearFrames',
      'volumeState'
    ] as const)
      root.dataset[key] = String(stats[key])
    status.hidden = stats.volumeState !== 'unavailable'
    if (stats.volumeMessage) status.textContent = stats.volumeMessage
    root.querySelector<HTMLElement>('#cloud-detail')!.textContent =
      stats.volumeMessage ??
      (stats.volumeWeight > 0 ? `Объём: ${Math.round(stats.volumeWeight * 100)}%` : 'Объём отключён вдали')
    root.querySelector<HTMLElement>('#altitude')!.textContent =
      `${stats.altitudeKm.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`
    root.querySelector<HTMLElement>('#frame-time')!.textContent = `${stats.frameMs.toFixed(1)} мс`
  }
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener(
      'click',
      () => {
        lab?.setView(button.dataset.view as CloudView)
        root
          .querySelectorAll('[data-view]')
          .forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
      },
      events
    )
  })
  root
    .querySelector<HTMLInputElement>('#clouds-enabled')!
    .addEventListener('change', (event) => lab?.setCloudsEnabled((event.target as HTMLInputElement).checked), events)
  root
    .querySelector<HTMLSelectElement>('#quality')!
    .addEventListener(
      'change',
      (event) => lab?.setQuality((event.target as HTMLSelectElement).value as EarthCloudQuality),
      events
    )
  root.querySelector<HTMLInputElement>('#sun-angle')!.addEventListener(
    'input',
    (event) => {
      const degrees = Number((event.target as HTMLInputElement).value)
      root.querySelector<HTMLOutputElement>('#sun-value')!.value = `${degrees}°`
      lab?.setSunAngle(degrees)
    },
    events
  )

  // Allow the loading state to paint before GPU LUT preparation.
  let startupFrame = requestAnimationFrame(() => {
    startupFrame = requestAnimationFrame(() => {
      if (disposed) return
      session = startEarthCloudSession({
        load: loadEarthTextures,
        create: (textures) =>
          new EarthCloudLab(root.querySelector<HTMLElement>('.cloud-viewport')!, publish, fail, textures),
        onReady: (ready) => {
          lab = ready
          root
            .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')
            .forEach((control) => {
              control.disabled = false
            })
          publish(ready.getStats())
        },
        onError: fail
      })
    })
  })
  function dispose(): void {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(startupFrame)
    abort.abort()
    session?.dispose()
    session = undefined
    lab = undefined
  }
  return dispose
}

// Lifecycle listeners survive a cached departure; each mount owns its UI and load.
const lifecycle = new AbortController()
let release: (() => void) | undefined = mount()
function disposePage(): void {
  release?.()
  release = undefined
  lifecycle.abort()
}
window.addEventListener(
  'pagehide',
  (event) => {
    release?.()
    release = undefined
    if (!event.persisted) disposePage()
  },
  { signal: lifecycle.signal }
)
window.addEventListener(
  'pageshow',
  (event) => {
    if (event.persisted && !release) release = mount()
  },
  { signal: lifecycle.signal }
)
if (import.meta.hot) import.meta.hot.dispose(disposePage)
