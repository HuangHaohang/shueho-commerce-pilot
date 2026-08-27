WITH corrected AS (
  UPDATE generic_source_record record
  SET record_kind = 'product'
  FROM generic_source_snapshot snapshot
  WHERE snapshot.id = record.snapshot_id
    AND snapshot.response_family = 'commerce_product'
    AND jsonb_typeof(record.raw_data) = 'object'
    AND record.raw_data ?| ARRAY[
      'itemId','item_id','wareId','ware_id','wareid','skuId','sku_id','skuid',
      'productId','product_id','asin'
    ]
    AND record.record_kind <> 'product'
  RETURNING record.id
)
UPDATE business_evidence_observation evidence
SET evidence_kind = 'product'
WHERE evidence.source_record_id IN (SELECT id FROM corrected)
  AND evidence.evidence_kind <> 'product';

UPDATE research_workflow_business_evidence workflow_evidence
SET evidence_kind = 'product'
FROM generic_source_record source
WHERE source.id = workflow_evidence.source_record_id
  AND source.record_kind = 'product'
  AND workflow_evidence.evidence_kind <> 'product';

COMMENT ON COLUMN generic_source_record.record_kind IS
  'Provider-neutral kind; direct product identifiers in commerce_product responses take precedence over nested comment or metric field names.';
