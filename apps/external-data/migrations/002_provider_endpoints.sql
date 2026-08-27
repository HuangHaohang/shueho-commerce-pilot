INSERT INTO provider_endpoint (
  endpoint_id, platform_id, display_name, capability, api_path, http_method,
  schema_version, request_schema, response_family, enabled
)
VALUES
  (
    'search.search_v1',
    'search',
    '跨平台最新内容搜索',
    '搜索新闻、微博、微信、知乎、抖音、小红书、哔哩哔哩和快手上的最新公开内容，并按来源和时间过滤。',
    '/api/search/v1',
    'GET',
    'v1',
    '{
      "type":"object",
      "additionalProperties":false,
      "properties":{
        "keyword":{"type":"string","maxLength":500},
        "source":{"type":"string","enum":["ALL","NEWS","WEIBO","WEIXIN","ZHIHU","DOUYIN","XIAOHONGSHU","BILIBILI","KUAISHOU"],"default":"ALL"},
        "start":{"type":"string"},
        "end":{"type":"string"},
        "nextCursor":{"type":"string"}
      }
    }'::jsonb,
    'social_search_v1',
    true
  ),
  (
    'taobao.search_item_list_v1',
    'taobao',
    '淘宝和天猫商品搜索',
    '通过关键词搜索淘宝和天猫商品，支持分页、销量或价格排序、仅天猫和价格区间筛选。',
    '/api/taobao/search-item-list/v1',
    'GET',
    'v1',
    '{
      "type":"object",
      "additionalProperties":false,
      "required":["keyword"],
      "properties":{
        "keyword":{"type":"string","minLength":1,"maxLength":200},
        "sort":{"type":"string","enum":["_sale","_bid","bid","_coefp"],"default":"_sale"},
        "tmall":{"type":"boolean","default":false},
        "startPrice":{"type":"string"},
        "endPrice":{"type":"string"},
        "page":{"type":"integer","minimum":1,"default":1}
      }
    }'::jsonb,
    'taobao_search_item_list_v1',
    true
  )
ON CONFLICT (endpoint_id) DO UPDATE
SET platform_id = EXCLUDED.platform_id,
    display_name = EXCLUDED.display_name,
    capability = EXCLUDED.capability,
    api_path = EXCLUDED.api_path,
    http_method = EXCLUDED.http_method,
    schema_version = EXCLUDED.schema_version,
    request_schema = EXCLUDED.request_schema,
    response_family = EXCLUDED.response_family,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;
