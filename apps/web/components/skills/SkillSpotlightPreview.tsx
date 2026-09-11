"use client";

import { useEffect, useRef, type PointerEvent } from 'react'
import type { SkillExample as CreativeSkillExample } from '@/lib/agent/skills'

/** Pointer-driven visual preview only; each row retains its own demo identity. */
export function SkillSpotlightPreview({ title, examples }: { title: string; examples: CreativeSkillExample[] }) {
  const frame = useRef<number | null>(null)
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const element = event.currentTarget
    const { clientX } = event
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const bounds = element.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
      element.style.setProperty('--preview-pan', String(x))

      frame.current = null
    })
  }
  const leave = (event: PointerEvent<HTMLDivElement>) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    event.currentTarget.style.removeProperty('--preview-pan')
  }
  return <div className={`skill-spotlight${examples.length === 1 ? ' is-single-example' : ''}`} role="img" aria-label={`${title} · ${examples.length} 套独立图片示例`}
    onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
    {[0, 1].map(row => {
      const example = examples[row % examples.length]
      return <div className="skill-spotlight-row" key={row} data-example={example.url} aria-hidden="true">
        <div className="skill-spotlight-track">
          {Array.from({length: examples.length === 1 ? 3 : 6}, (_, index) => {
            const panel = examples.length === 1 ? row * 3 + index : index
            return <div className="skill-spotlight-tile" key={panel}>
            <img src={example.url} alt="" loading="lazy" draggable={false}
              style={{left:`${-(panel % 3) * 100}%`,top:`${-Math.floor(panel / 3) * 100}%`}} />
          </div>})}
        </div>
      </div>
    })}
  </div>
}
