"use client";

import type { SkillExample as CreativeSkillExample } from '@/lib/agent/skills'
import { APlusPreview } from './APlusPreview'
import { SkillSpotlightPreview } from './SkillSpotlightPreview'

export function SkillPreviewMotion({ src, title, examples, layout }: {
  src: string; title: string; examples?: CreativeSkillExample[]; layout?: 'strips' | 'a-plus' | 'cover'
}) {
  const items: CreativeSkillExample[] = examples?.length ? examples : [{url: src, title}]
  if (layout === 'cover') return <img className="skill-preview-whole-image" src={items[0].url} alt={`${title}效果示例`} loading="lazy" draggable={false} />
  if (layout === 'a-plus' && items.every(item => item.detail_url)) return <APlusPreview examples={items} />
  return <SkillSpotlightPreview title={title} examples={items} />
}
