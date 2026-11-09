import { useEffect, useState, type ReactNode } from 'react'

export interface StageProps {
  hasCamera: boolean
  banners: ReactNode
}

/** Centre: banners on top, then the OBS program output preview (16:9, letterboxed) and its caption. */
export function Stage({ hasCamera, banners }: StageProps) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => window.lintoLive.on('preview', setPreview), [])

  return (
    <section className="stage" aria-label="Aperçu">
      {banners && <div className="stage-banners">{banners}</div>}
      <div className="stage-body">
        <figure className="stage-figure">
          <div className="stage-frame">
            {!hasCamera ? (
              <span className="stage-placeholder">Choisis une caméra</span>
            ) : preview ? (
              <img src={preview} alt="Aperçu de la sortie OBS" draggable={false} />
            ) : (
              <span className="stage-placeholder">Aperçu en attente…</span>
            )}
          </div>
          <figcaption className="stage-caption">Sortie OBS — ce qui s'affiche dans la fenêtre de sortie</figcaption>
        </figure>
      </div>
    </section>
  )
}
