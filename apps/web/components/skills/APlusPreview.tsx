"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SkillExample as CreativeSkillExample } from '@/lib/agent/skills'

export function APlusPreview({ examples }: { examples: CreativeSkillExample[] }) {
  const [index, setIndex] = useState(0)
  const [distance, setDistance] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const example = examples[index % examples.length]
  useEffect(() => {
    const measure = () => setDistance(Math.max(0, (image.current?.offsetHeight ?? 0) - (viewport.current?.clientHeight ?? 0)))
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (image.current) observer.observe(image.current)
    measure()
    return () => observer.disconnect()
  }, [example])
  return <div className="a-plus-preview" role="img" aria-label={`${example.title}：固定商品与纵向详情预览`}>
    <div className="a-plus-product" aria-hidden="true">
      <img src={example.url} alt="" draggable={false} style={{width: `${100 / (example.product_fraction ?? 0.4)}%`}} />
    </div>
    <div className="a-plus-detail" ref={viewport} aria-hidden="true">
      <img ref={image} key={example.detail_url} src={example.detail_url} alt="" draggable={false}
        style={{'--detail-travel': `${distance}px`} as CSSProperties}
        onAnimationIteration={() => { if (examples.length > 1) setIndex(current => (current + 1) % examples.length) }} />
    </div>
  </div>
}
