import { FC } from 'react'
import { Customizable } from '@titanui/types'

export interface TitanTab {
  key: string
  label: string
  badge?: number
}

export interface TitanTabsProps extends Customizable {
  tabs: TitanTab[]
  active: string
  onChange(key: string): void
}

const TitanTabs: FC<TitanTabsProps> = ({ tabs, active, onChange, style = {} }) => {
  return (
    <div className="titan-tabs" style={style}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`titan-tab ${tab.key === active ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="titan-tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export default TitanTabs
