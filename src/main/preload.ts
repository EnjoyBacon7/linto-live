import { contextBridge, ipcRenderer } from 'electron'
import { createLintoLiveApi } from '../shared/ipc'

contextBridge.exposeInMainWorld(
  'lintoLive',
  createLintoLiveApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, l) => void ipcRenderer.on(channel, l),
    off: (channel, l) => void ipcRenderer.removeListener(channel, l)
  })
)
