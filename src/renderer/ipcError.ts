/** Electron prefixes errors thrown in main handlers: "Error invoking remote method '<ch>': Error: <msg>". */
export function ipcErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const msg = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:\w*Error):\s*/, '').trim()
  return msg || 'Erreur inconnue.'
}
