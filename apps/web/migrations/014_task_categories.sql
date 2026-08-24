ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_category_check;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_category_check
  CHECK (category IS NULL OR category IN (
    'creative', 'research', 'operations', 'support', 'analytics', 'general'
  ));

UPDATE commerce_agent_thread SET category = 'creative'
WHERE category IS NULL AND recipe_id = 'copywriting';

UPDATE commerce_agent_thread SET category = 'creative'
WHERE category IS NULL AND title ~ '(文案|脚本|图片|视频|主图|种草|上新|创作)';
UPDATE commerce_agent_thread SET category = 'research'
WHERE category IS NULL AND title ~ '(调研|竞品|趋势|市场|洞察|研究)';
UPDATE commerce_agent_thread SET category = 'operations'
WHERE category IS NULL AND title ~ '(订单|库存|退款|发货|履约|店铺运营|商品上下架)';
UPDATE commerce_agent_thread SET category = 'support'
WHERE category IS NULL AND title ~ '(客服|售后|投诉|评价|工单|纠纷)';
UPDATE commerce_agent_thread SET category = 'analytics'
WHERE category IS NULL AND title ~ '(报表|日报|周报|复盘|销售数据|广告数据|经营分析)';
UPDATE commerce_agent_thread SET category = 'general'
WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS commerce_agent_thread_category_updated_idx
ON commerce_agent_thread (tenant_id, workspace_id, created_by_user_id, category, updated_at DESC);
