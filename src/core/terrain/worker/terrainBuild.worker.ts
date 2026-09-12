import { createWorkerState, handleWorkerMessage } from './terrainBuildHandler'
import type { FromWorkerMessage, ToWorkerMessage } from './terrainBuildProtocol'

const state = createWorkerState()
// self в воркере — DedicatedWorkerGlobalScope; корневой tsconfig несёт DOM-типы, поэтому postMessage типизируется структурно
const post = (self as unknown as { postMessage(message: FromWorkerMessage, transfer: Transferable[]): void }).postMessage.bind(self)

self.onmessage = (event: MessageEvent<ToWorkerMessage>): void => {
  const out = handleWorkerMessage(state, event.data)
  if (out) post(out.message, out.transfer)
}
