WITH normalized AS (
  SELECT record.id,
         COALESCE(
           record.raw_data #>> '{priceInfoView,value}',
           record.raw_data #>> '{priceInfo,p}',
           record.raw_data ->> 'dredisprice',
           record.raw_data ->> 'price'
         ) AS price_text,
         COALESCE(
           record.raw_data #>> '{priceInfoView,originPrice}',
           record.raw_data #>> '{priceInfo,op}',
           record.raw_data ->> 'originalPrice',
           record.raw_data ->> 'original_price'
         ) AS original_price_text,
         COALESCE(
           record.raw_data #>> '{commentData,comment}',
           record.raw_data ->> 'reviewCountText',
           record.raw_data ->> 'review_count_text'
         ) AS review_display,
         COALESCE(
           record.raw_data #>> '{commentData,goodRateNew}',
           record.raw_data #>> '{commentData,goodRate}',
           record.raw_data ->> 'goodRate',
           record.raw_data ->> 'good_rate'
         ) AS good_rate_text,
         COALESCE(record.raw_data ->> 'shopName', record.raw_data ->> 'shop_name') AS shop_name,
         COALESCE(
           record.raw_data ->> 'detailLink',
           record.raw_data ->> 'detail_link',
           record.raw_data ->> 'jumpDetailLink',
           record.raw_data ->> 'jump_detail_link'
         ) AS product_url,
         CASE WHEN jsonb_typeof(record.raw_data -> 'isAd') = 'boolean'
           THEN (record.raw_data ->> 'isAd')::boolean ELSE NULL END AS is_ad
  FROM generic_source_record record
  JOIN generic_source_snapshot snapshot ON snapshot.id=record.snapshot_id
  WHERE snapshot.response_family='commerce_product' AND record.record_kind='product'
), updated AS (
  UPDATE generic_source_record record
  SET metrics = record.metrics || jsonb_strip_nulls(jsonb_build_object(
        'price_yuan', CASE WHEN normalized.price_text ~ '^[0-9]+([.][0-9]+)?$'
          THEN normalized.price_text::numeric ELSE NULL END,
        'original_price_yuan', CASE WHEN normalized.original_price_text ~ '^[0-9]+([.][0-9]+)?$'
          THEN normalized.original_price_text::numeric ELSE NULL END,
        'review_display', NULLIF(normalized.review_display, ''),
        'good_rate_percent', CASE WHEN normalized.good_rate_text ~ '^[0-9]+([.][0-9]+)?$'
          THEN normalized.good_rate_text::numeric ELSE NULL END,
        'is_ad', normalized.is_ad
      )),
      author_raw = COALESCE(record.author_raw, NULLIF(normalized.shop_name, '')),
      canonical_url = COALESCE(
        record.canonical_url,
        CASE
          WHEN normalized.product_url LIKE '//%' THEN 'https:' || normalized.product_url
          WHEN normalized.product_url ~ '^https?://' THEN normalized.product_url
          ELSE NULL
        END
      )
  FROM normalized
  WHERE normalized.id=record.id
  RETURNING record.id,record.metrics,record.author_raw,record.canonical_url
)
UPDATE business_evidence_observation evidence
SET metrics=updated.metrics,
    author=COALESCE(evidence.author,updated.author_raw),
    canonical_url=COALESCE(evidence.canonical_url,updated.canonical_url)
FROM updated
WHERE evidence.source_record_id=updated.id;

UPDATE research_workflow_business_evidence workflow_evidence
SET metrics=source.metrics,
    canonical_url=COALESCE(workflow_evidence.canonical_url,source.canonical_url)
FROM generic_source_record source
WHERE source.id=workflow_evidence.source_record_id
  AND source.record_kind='product';

COMMENT ON COLUMN generic_source_record.metrics IS
  'Provider metrics plus canonical commerce fields such as price_yuan; review counts remain review evidence and are never labeled as sales.';
