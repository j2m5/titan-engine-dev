import { observer } from 'mobx-react-lite'
import { engineStore } from '@/ui/mobX/EngineStore'

const LoadingScreen = observer(() => {
  return (
    <div className="loading-screen">
      <div className="loading-screen-data">
        <div className="counter">{engineStore.loadingPercentage}%</div>
        <div className="progressbar">
          <span className="progress" style={{ width: engineStore.loadingPercentage + '%' }}></span>
        </div>
        <div className="file">{engineStore.appLoadingAsset}</div>
      </div>
    </div>
  )
})

export default LoadingScreen
