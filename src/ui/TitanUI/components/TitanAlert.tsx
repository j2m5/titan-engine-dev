import { FC } from 'react'
import { AlertType, TitanAlertProps } from '@titanui/types'
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react'

const icon = (type: AlertType) => {
  switch (type) {
    case 'success':
      return <CheckCircleIcon size={24} />
    case 'error':
      return <XCircleIcon size={24} />
    case 'warning':
      return <WarningCircleIcon size={24} />
    case 'info':
    default:
      return <InfoIcon size={24} />
  }
}

const TitanAlert: FC<TitanAlertProps> = ({ type = 'info', message = '', showIcon = false }) => {
  return (
    <div className={`titan-alert ${type}`}>
      {showIcon && <div className={`titan-alert-icon ${type}`}>{icon(type)}</div>} {message}
    </div>
  )
}

export default TitanAlert
