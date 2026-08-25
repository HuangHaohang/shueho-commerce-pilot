UPDATE commerce_agent_thread
SET category = CASE
  WHEN recipe_id = 'copywriting' THEN 'creative'
  WHEN title ~ '(调研|竞品|趋势|市场洞察|用户洞察|行业研究)' THEN 'research'
  WHEN title ~ '(订单|库存|退款|发货|履约|店铺运营|商品上下架|商品上架|商品下架)' THEN 'operations'
  WHEN title ~ '(客服|售后|投诉|评价回复|工单|纠纷|客户回复)' THEN 'support'
  WHEN title ~ '(报表|日报|周报|复盘|销售数据|广告数据|经营分析|数据分析)' THEN 'analytics'
  WHEN title ~ '(文案|脚本|图片生成|视频生成|主图|种草|创作|标题改写|卖点)' THEN 'creative'
  WHEN title ~ '(技能|插件|系统配置|使用说明|信息清单)' THEN 'general'
  ELSE category
END
WHERE recipe_id = 'copywriting'
   OR title ~ '(调研|竞品|趋势|市场洞察|用户洞察|行业研究|订单|库存|退款|发货|履约|店铺运营|商品上下架|商品上架|商品下架|客服|售后|投诉|评价回复|工单|纠纷|客户回复|报表|日报|周报|复盘|销售数据|广告数据|经营分析|数据分析|文案|脚本|图片生成|视频生成|主图|种草|创作|标题改写|卖点|技能|插件|系统配置|使用说明|信息清单)';
