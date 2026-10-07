import { observer } from 'mobx-react-lite'
import TitanToast from '@titanui/components/TitanToast'
import TitanAlert from '@titanui/components/TitanAlert'
import { notificationStore } from '@/ui/mobx/NotificationStore'

/**
 * Тосты — одной стопкой (titan-toast-stack): старый внизу, новые выше. Прежний
 * ручной шаг 72px налезал на соседа, как только текст переносился на вторую строку.
 */
const NotificationMessage = observer(() => {
  const ntfStore = notificationStore

  return (
    <div className="titan-toast-stack">
      {ntfStore.notifications.map((notification) => (
        <TitanToast
          key={notification.id}
          visible={true}
          duration={ntfStore.delay}
          onClose={() => ntfStore.release(notification.id)}
        >
          <TitanAlert type={notification.type} message={notification.message} showIcon />
        </TitanToast>
      ))}
    </div>
  )
})

export default NotificationMessage
