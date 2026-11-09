/** Exposes the OS on <html data-platform> so theme.css can adapt (vibrancy on macOS, solid on Linux). */
export function applyPlatform(doc: Document, platform: string): void {
  doc.documentElement.dataset.platform = platform
}
