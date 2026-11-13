/** Public LinTO Studio page of a session (`instance` has no trailing slash). */
export function publicLink(instance: string, orgId: string, sessionId: string): string {
  return `${instance}/interface/${orgId}/sessions/${sessionId}`
}
