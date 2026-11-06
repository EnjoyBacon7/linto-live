import type { LintoLiveApi } from '../shared/ipc'

declare global {
  interface Window {
    lintoLive: LintoLiveApi
  }
}
export {}
