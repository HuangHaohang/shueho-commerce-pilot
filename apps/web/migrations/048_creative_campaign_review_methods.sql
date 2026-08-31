ALTER TABLE commerce_creative_canvas_node
  DROP CONSTRAINT IF EXISTS commerce_creative_canvas_node_deliverable_type_check;

ALTER TABLE commerce_creative_canvas_node
  ADD CONSTRAINT commerce_creative_canvas_node_deliverable_type_check
  CHECK (
    deliverable_type IS NULL OR deliverable_type IN (
      'campaign_pack',
      'listing_copy',
      'promotion_copy',
      'main_image',
      'gallery_images',
      'detail_page',
      'shooting_script',
      'video_storyboard',
      'creative_qa'
    )
  );

COMMENT ON CONSTRAINT commerce_creative_canvas_node_deliverable_type_check
  ON commerce_creative_canvas_node IS
  'Allows only application-managed Creative Space deliverable methods while preserving nullable legacy projections.';
