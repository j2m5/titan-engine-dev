import { observer } from 'mobx-react-lite'
import { engineStore } from '@/ui/mobx/EngineStore'

/** Только имя файла: полный URL бакета длинный и ничего не говорит пользователю */
const fileName = (url: string): string => url.split('/').pop() ?? url

const LoadingScreen = observer(() => {
  return (
    <div className="loading-screen">
      <div className="loading-screen-data">
        <div className="counter">{engineStore.loadingPercentage}%</div>
        <div className="progressbar">
          <span className="progress" style={{ width: engineStore.loadingPercentage + '%' }}></span>
        </div>
        <div className="file">{fileName(engineStore.appLoadingAsset)}</div>
      </div>
    </div>
  )
})

export default LoadingScreen
