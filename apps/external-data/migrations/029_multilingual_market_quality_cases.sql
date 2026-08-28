INSERT INTO quality_evaluation_case (id,query_text,document_text,expected_relevant,category)
VALUES
  (
    'shopee-tw-joggers-relevant',
    'Shopee 台湾站休闲运动裤；本地检索词：休閒運動褲',
    '台灣現貨 美式休閒運動長褲 衛褲寬鬆百搭直筒長褲',
    true,
    'market_zh_hant_relevant'
  ),
  (
    'shopee-tw-shorts-adjacent',
    'Shopee 台湾站休闲运动裤；本地检索词：休閒運動褲',
    '男士冰絲薄款五分運動褲 寬鬆跑步休閒短褲',
    true,
    'market_zh_hant_adjacent'
  ),
  (
    'shopee-tw-phone-irrelevant',
    'Shopee 台湾站休闲运动裤；本地检索词：休閒運動褲',
    '台灣出貨 iPhone 16 Pro 防摔手機殼 鏡頭保護套',
    false,
    'market_zh_hant_cross_category'
  ),
  (
    'shopee-th-joggers-relevant',
    'Shopee Thailand casual sports pants; คำค้นหา: กางเกงกีฬาลำลอง',
    'กางเกงวอร์มผู้ชายขายาว น้ำหนักเบา ผ้าระบายอากาศ สำหรับวิ่งและลำลอง',
    true,
    'market_th_relevant'
  ),
  (
    'shopee-th-cosmetics-irrelevant',
    'Shopee Thailand casual sports pants; คำค้นหา: กางเกงกีฬาลำลอง',
    'ลิปสติกเนื้อแมตต์ติดทนนาน สีแดงธรรมชาติ เครื่องสำอางสำหรับผู้หญิง',
    false,
    'market_th_cross_category'
  ),
  (
    'shopee-id-joggers-relevant',
    'Shopee Indonesia celana olahraga kasual',
    'Celana jogger pria panjang ringan untuk olahraga lari dan pemakaian santai',
    true,
    'market_id_relevant'
  ),
  (
    'singapore-joggers-relevant',
    'Singapore marketplace lightweight casual jogger pants',
    'Lightweight breathable men jogger pants for commuting, gym and casual wear',
    true,
    'market_en_sg_relevant'
  ),
  (
    'singapore-laptop-irrelevant',
    'Singapore marketplace lightweight casual jogger pants',
    'Gaming laptop RTX 5090 32GB RAM high performance notebook computer',
    false,
    'market_en_sg_cross_category'
  )
ON CONFLICT (id) DO UPDATE
SET query_text=EXCLUDED.query_text,
    document_text=EXCLUDED.document_text,
    expected_relevant=EXCLUDED.expected_relevant,
    category=EXCLUDED.category,
    active=true;
