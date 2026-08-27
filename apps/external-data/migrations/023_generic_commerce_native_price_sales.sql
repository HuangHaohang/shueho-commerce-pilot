WITH extracted AS (
  SELECT record.id,
         COALESCE(
           record.raw_data ->> 'display_price',
           record.raw_data ->> 'displayPrice',
           record.raw_data ->> 'salePrice',
           record.raw_data ->> 'sale_price',
           record.raw_data ->> 'dredisprice',
           record.raw_data #>> '{priceInfoView,value}',
           record.raw_data #>> '{priceInfo,p}',
           record.raw_data ->> 'price',
           record.metrics ->> 'price_yuan'
         ) AS price_text,
         COALESCE(
           record.raw_data ->> 'originalPriceAmount',
           record.raw_data ->> 'originalPrice',
           record.raw_data ->> 'original_price',
           record.raw_data #>> '{priceInfoView,originPrice}',
           record.raw_data #>> '{priceInfo,op}',
           record.metrics ->> 'original_price_yuan'
         ) AS original_price_text,
         upper(NULLIF(trim(COALESCE(
           record.raw_data ->> 'currency',
           record.raw_data ->> 'currencyCode',
           record.raw_data ->> 'currency_code',
           CASE WHEN snapshot.endpoint_id LIKE 'taobao.%'
                  OR snapshot.endpoint_id LIKE 'jd.%'
                  OR snapshot.endpoint_id LIKE '1688.%'
                  OR snapshot.endpoint_id LIKE 'douyin_ec.%'
                  OR snapshot.endpoint_id LIKE 'xianyu.%'
             THEN 'CNY' ELSE NULL END
         )), '')) AS currency_text,
         CASE WHEN jsonb_typeof(record.raw_data -> 'price_texts')='array'
           THEN record.raw_data -> 'price_texts'
           WHEN jsonb_typeof(record.raw_data -> 'priceTexts')='array'
           THEN record.raw_data -> 'priceTexts'
           ELSE NULL END AS price_texts,
         NULLIF(trim(COALESCE(
           record.raw_data ->> 'sold_text',
           record.raw_data ->> 'soldText',
           record.raw_data ->> 'sales_display',
           record.raw_data ->> 'salesDisplay',
           record.raw_data ->> 'salesText',
           record.raw_data ->> 'sales_text'
         )), '') AS sales_display,
         NULLIF(trim(COALESCE(
           record.raw_data ->> 'image_url',
           record.raw_data ->> 'imageUrl',
           record.raw_data ->> 'mainImage',
           record.raw_data ->> 'main_image'
         )), '') AS image_url
  FROM generic_source_record record
  JOIN generic_source_snapshot snapshot ON snapshot.id=record.snapshot_id
  WHERE snapshot.response_family='commerce_product' AND record.record_kind='product'
), parsed AS (
  SELECT extracted.*,
         regexp_match(
           replace(COALESCE(extracted.sales_display, ''), ',', ''),
           '([0-9]+([.][0-9]+)?)[[:space:]]*(亿|万|千|พัน|หมื่น|แสน|ล้าน|ribu|juta|rb|jt|[kKmMbB])?'
         ) AS sales_parts
  FROM extracted
), canonical AS (
  SELECT parsed.*,
         CASE WHEN replace(parsed.price_text, ',', '') ~ '^[0-9]+([.][0-9]+)?$'
           THEN replace(parsed.price_text, ',', '')::numeric ELSE NULL END AS price_amount,
         CASE WHEN replace(parsed.original_price_text, ',', '') ~ '^[0-9]+([.][0-9]+)?$'
           THEN replace(parsed.original_price_text, ',', '')::numeric ELSE NULL END AS original_price_amount,
         CASE WHEN parsed.currency_text ~ '^[A-Z]{3}$' THEN parsed.currency_text ELSE NULL END AS currency,
         CASE WHEN parsed.sales_parts IS NOT NULL THEN floor(
           parsed.sales_parts[1]::numeric * CASE lower(COALESCE(parsed.sales_parts[3], ''))
             WHEN '亿' THEN 100000000
             WHEN '万' THEN 10000
             WHEN 'หมื่น' THEN 10000
             WHEN 'แสน' THEN 100000
             WHEN 'ล้าน' THEN 1000000
             WHEN 'juta' THEN 1000000
             WHEN 'jt' THEN 1000000
             WHEN 'm' THEN 1000000
             WHEN 'b' THEN 1000000000
             WHEN '千' THEN 1000
             WHEN 'พัน' THEN 1000
             WHEN 'ribu' THEN 1000
             WHEN 'rb' THEN 1000
             WHEN 'k' THEN 1000
             ELSE 1 END
         )::bigint ELSE NULL END AS sales_lower_bound
  FROM parsed
), updated AS (
  UPDATE generic_source_record record
  SET metrics = record.metrics || jsonb_strip_nulls(jsonb_build_object(
        'price_amount', canonical.price_amount,
        'original_price_amount', canonical.original_price_amount,
        'price_yuan', CASE WHEN canonical.currency='CNY' THEN canonical.price_amount ELSE NULL END,
        'original_price_yuan', CASE WHEN canonical.currency='CNY' THEN canonical.original_price_amount ELSE NULL END,
        'currency', canonical.currency,
        'price_texts', canonical.price_texts,
        'price_display', canonical.price_texts ->> 0,
        'sales_display', canonical.sales_display,
        'sales_lower_bound', canonical.sales_lower_bound,
        'sales_upper_bound', CASE
          WHEN canonical.sales_lower_bound IS NOT NULL
            AND COALESCE(canonical.sales_parts[3], '')=''
            AND canonical.sales_display !~ '[+]|以上|起|至少|กว่า|ขึ้นไป|มากกว่า'
          THEN canonical.sales_lower_bound ELSE NULL END,
        'sales_qualifier', CASE
          WHEN canonical.sales_lower_bound IS NULL THEN NULL
          WHEN COALESCE(canonical.sales_parts[3], '')<>''
            OR canonical.sales_display ~ '[+]|以上|起|至少|กว่า|ขึ้นไป|มากกว่า'
          THEN 'gte' ELSE 'exact' END,
        'image_url', CASE WHEN canonical.image_url ~ '^https?://' THEN canonical.image_url ELSE NULL END
      ))
  FROM canonical
  WHERE canonical.id=record.id
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

UPDATE generic_source_record record
SET record_kind='metric'
FROM generic_source_snapshot snapshot
WHERE snapshot.id=record.snapshot_id
  AND snapshot.response_family='commerce_product'
  AND record.provider_entity_id IS NULL
  AND record.record_kind<>'metric'
  AND record.json_pointer ~ '/(price_texts|priceTexts)/[0-9]+$';

COMMENT ON COLUMN generic_source_record.metrics IS
  'Provider metrics plus canonical native-currency price and sales fields. Foreign prices are never labeled price_yuan; raw provider displays and qualifiers are preserved.';
