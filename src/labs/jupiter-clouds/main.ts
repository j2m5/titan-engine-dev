import './style.css'
import { JupiterCloudLab } from './JupiterCloudLab'
import type { CloudView } from './CloudFlight'
import { SRGBColorSpace, TextureLoader } from 'three'
import jupiterTextureUrl from './assets/jupiter.jpg'

const root = document.querySelector<HTMLElement>('#cloud-lab')!
root.innerHTML = `
  <div class="cloud-viewport"></div>
  <section class="cloud-panel" aria-label="Управление облаками">
    <a class="back-link" href="./">← TitanEngine</a>
    <p class="eyebrow">ЭКСПЕРИМЕНТ · 01</p>
    <h1>Юпитер<span>Объёмные облака</span></h1>
    <p class="description">С орбиты — исходная текстура Юпитера. Объёмный слой 10–30 км плавно появляется при сближении.</p>
    <div class="view-buttons" role="group" aria-label="Положение камеры">
      <button data-view="orbit" aria-pressed="true">Орбита</button>
      <button data-view="approach" aria-pressed="false">Переход</button>
      <button data-view="above" aria-pressed="false">Над облаками</button>
      <button data-view="inside" aria-pressed="false">Внутри слоя</button>
      <button data-view="below" aria-pressed="false">Под облаками</button>
    </div>
    <label class="control-row"><span>Облака</span><input id="clouds-enabled" type="checkbox" checked /></label>
    <label class="control-row"><span>Качество</span><select id="cloud-quality">
      <option value="low">Низкое</option><option value="medium" selected>Среднее</option><option value="high">Высокое</option>
    </select></label>
    <details class="distance-controls"><summary>Расстояние появления</summary>
      <p>Над верхней границей облаков, км</p>
      <label class="control-row"><span>Полный объём</span><input id="cloud-full-distance" type="number" min="0" max="99999" value="100" step="10" /></label>
      <label class="control-row"><span>Отключение вдали</span><input id="cloud-cutoff-distance" type="number" min="1" max="100000" value="1000" step="10" /></label>
    </details>
    <p id="cloud-detail" class="detail-status">Объём отключён вдали</p>
    <label class="sun-control" for="sun-angle">Солнце <output id="sun-value">35°</output></label>
    <input id="sun-angle" type="range" min="0" max="120" value="35" step="1" />
    <div class="telemetry"><span>Высота <b id="altitude">—</b></span><span>Кадр <b id="frame-time">—</b></span></div>
    <p class="flight-help">Перетаскивание — обзор · WASD — полёт<br>Q/E — вниз/вверх · Shift — быстрее · Колесо — вперёд/назад</p>
    <p class="credits">Облака: Takram · Атмосфера и LUT: TitanEngine</p>
  </section>
  <div class="cloud-status" role="status">Подготовка атмосферы и облаков…</div>
`
const viewport = root.querySelector<HTMLElement>('.cloud-viewport')!
const status = root.querySelector<HTMLElement>('.cloud-status')!
const altitude = root.querySelector<HTMLElement>('#altitude')!
const frameTime = root.querySelector<HTMLElement>('#frame-time')!
const abort = new AbortController()
const options = { signal: abort.signal }
let lab: JupiterCloudLab | undefined
let disposed = false
let failed = false

function fail(error: unknown): void {
  failed = true
  status.hidden = false
  status.textContent = error instanceof Error ? error.message : String(error)
  status.setAttribute('role', 'alert')
  root.dataset.state = 'error'
  console.error(error)
}

// Leave a paint opportunity before the synchronous GPU precomputation.
let startupFrame = requestAnimationFrame(() => {
  startupFrame = requestAnimationFrame(initialize)
})

async function initialize(): Promise<void> {
  if (disposed) return
  try {
    const texture = await new TextureLoader().loadAsync(jupiterTextureUrl)
    if (disposed) {
      texture.dispose()
      return
    }
    texture.colorSpace = SRGBColorSpace
    lab = new JupiterCloudLab(
      viewport,
      (stats) => {
        if (failed) return
        status.hidden = true
        root.dataset.state = 'ready'
        root.dataset.frames = String(stats.frames)
        root.dataset.cloudFrames = String(stats.cloudFrames)
        root.dataset.cloudOpacity = String(stats.cloudOpacity)
        root.querySelector<HTMLElement>('#cloud-detail')!.textContent =
          stats.cloudOpacity > 0 ? `Объём: ${Math.round(stats.cloudOpacity * 100)}%` : 'Объём отключён'
        altitude.textContent = `${stats.altitudeKm.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км`
        frameTime.textContent = `${stats.frameMs.toFixed(1)} мс`
      },
      fail,
      texture
    )
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          lab?.setView(button.dataset.view as CloudView)
          root
            .querySelectorAll('[data-view]')
            .forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
        },
        options
      )
    })
    root.querySelector<HTMLInputElement>('#clouds-enabled')!.addEventListener(
      'change',
      (event) => {
        lab?.setCloudsEnabled((event.target as HTMLInputElement).checked)
      },
      options
    )
    root.querySelector<HTMLSelectElement>('#cloud-quality')!.addEventListener(
      'change',
      (event) => {
        lab?.setQuality((event.target as HTMLSelectElement).value as 'low' | 'medium' | 'high')
      },
      options
    )
    const fullDistance = root.querySelector<HTMLInputElement>('#cloud-full-distance')!
    const cutoffDistance = root.querySelector<HTMLInputElement>('#cloud-cutoff-distance')!
    const updateDistance = (): void => {
      cutoffDistance.setCustomValidity('')
      if (!fullDistance.checkValidity() || !cutoffDistance.checkValidity()) return
      try {
        lab?.setCloudDistance({ full: fullDistance.valueAsNumber * 1000, cutoff: cutoffDistance.valueAsNumber * 1000 })
      } catch (error) {
        cutoffDistance.setCustomValidity(error instanceof Error ? error.message : String(error))
        cutoffDistance.reportValidity()
      }
    }
    fullDistance.addEventListener('change', updateDistance, options)
    cutoffDistance.addEventListener('change', updateDistance, options)
    root.querySelector<HTMLInputElement>('#sun-angle')!.addEventListener(
      'input',
      (event) => {
        const degrees = Number((event.target as HTMLInputElement).value)
        root.querySelector<HTMLOutputElement>('#sun-value')!.value = `${degrees}°`
        lab?.setSunAngle(degrees)
      },
      options
    )
  } catch (error) {
    if (!disposed) fail(error)
  }
}

function dispose(): void {
  if (disposed) return
  disposed = true
  cancelAnimationFrame(startupFrame)
  abort.abort()
  lab?.dispose()
}
window.addEventListener(
  'pagehide',
  (event) => {
    if (!event.persisted) dispose()
  },
  options
)
if (import.meta.hot) import.meta.hot.dispose(dispose)
