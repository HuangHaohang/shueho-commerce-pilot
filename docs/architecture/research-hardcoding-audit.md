# Research hardcoding and Codex Harness boundary audit

审查基线：b9933e33713cfa79e8f724a1786ca63bcd468686。范围为 src/、apps/external-data/src/、apps/web/lib/、services/local-retrieval-models/src/ 中的 216 个生产 TypeScript/Python 文件（排除测试、verify/evaluate 入口），另检查本次修改和相关评估入口。

本清单按“同一种规则”计数，不把每个常量、每行命中计为一个缺陷，也不声称是全仓所有硬编码的总数。确认 14 组研究/检索策略规则，以及另外 2 个内部模型执行旁路。H01–H08 在本次代码中修正；H09–H14 与 B01/B02 已在后续修复中处理；对应实现和部署步骤见下文。

## 14 组规则与处理状态

位置未写完整路径的文件位于 apps/external-data/src/。

| 编号 | 基线位置/函数 | 写在代码里的规则 | 本次状态 |
| --- | --- | --- | --- |
| H01 | enrichment.ts / buildEnrichmentQueryText | 整段研究请求、重复标签、简繁/本地化词和执行说明合成一个 Query | 已修：只评估显式语义范围；等价检索词作为独立变体；不重新解释原始自由文本 |
| H02 | local-model-client.ts / rerank | 所有记录都必须匹配商品并支持请求指标 | 已修：仅判定主题和明确范围，指标与时间单独核验 |
| H03 | services/local-retrieval-models/src/local_retrieval_models/server.py / _load_reranker_model | 首次 instruction 被缓存，后续 instruction 没有传给 predict | 已修：按 Sentence Transformers 的 predict(prompt=...) 契约逐次传入 |
| H04 | enrichment.ts / relevanceScore | 词面/向量/重排按 0.25/0.25/0.5 混合成一个分数 | 已移除：使用 Reranker 原分数排序，不制造混合分数或校准概率 |
| H05 | enrichment.ts / modelSupported | 词面达到 0.6 时将 embedding 门槛放宽 0.08 | 已移除：保留已有配置/市场档案的两个门槛；同一查询变体必须同时满足，未降低门槛 |
| H06 | warehouse.ts / loadCompactResearchResult | 内容证据两处 LIMIT 50，加一处 slice(0,50)，与请求数量脱节 | 已修：内容证据截断读取该请求的 research_request.top_n；商品/品牌摘要属于 H14 |
| H07 | warehouse.ts、social-metric-coverage.ts | 零交付样本统一标 missing；时间限制模板被当成实际原因 | 已修：交付空集为 no_samples，另返回源字段和实际原因计数；没有晋级时不声称已晋级 |
| H08 | evaluate.ts、enrichment.test.ts | 固定简短 query 测模型，未走生产查询构造和准入；mock 分数遮蔽误判 | 已修：保留旧评估，增加完整生产链路真实模型回归，覆盖不同领域、多语言、排除和时间规则 |
| H09 | social-research-planner.ts / socialSortBinding, compareEndpointSpecificity | 写死两个排序枚举的意义，并按参数字段数挑接口 | 已修：读取不可变 research_policy_import_receipt；导入时校验官方接口 schema、分页参数及文档来源 |
| H10 | social-research-planner.ts、endpoint-registry.ts、Gateway/托管说明 | 社交日期固定 +08:00/Asia/Shanghai | 已修：时区来自导入档案，按 IANA 日期边界转换；包含 DST 测试，ISO provider 输入缺少时区元数据时拒绝猜测 |
| H11 | canonical.ts、generic-normalizer.ts / defaultCommerceCurrency | 特定端点补默认参数；按五个平台名补 CNY | 已修：移除端点参数分支和平台→币种表；默认参数仅由官方 schema 提供，未返回币种不自动补 CNY |
| H12 | social-research-planner.ts、src/mcp/research-service.ts | 社交研究固定一次调用，没有目标覆盖驱动的已治理分页计划 | 已修：新 execution_version=3 任务按导入的页码/游标协议采集，逐页原审批/预算/归档/结算；达到目标、源结束、重复页/游标或治理拒绝时停止，没有 N 条→N 页规则 |
| H13 | marketplace-workflow-execution.ts / representative selection | 同店惩罚 0.2、相关性/多样性权重 0.8/0.2 | 已修：原有参数进入不可变策略回执并随计划固定；兼容旧计划时读取首份基线回执，不增加新权重 |
| H14 | hybrid-search.ts、warehouse.ts | 检索候选固定 50/20，商品/品牌摘要固定 30、属性固定 50 | 已修：摘要使用请求 top_n，检索候选/RRF 参数读取策略回执且不低于请求数量；模型按协议批量处理，不静默截断 |

## 另外两个 Harness 执行旁路

| 编号 | 已核实调用链 | 边界事实 | 本次状态 |
| --- | --- | --- | --- |
| B01 | src/gateway/server.ts → CommerceProviderClient.generateThreadTitle → POST responses | 标题生成由应用直接请求模型，未通过 App Server 执行 | 已修：原生 App Server ephemeral thread/turn；原 Spark 模型保留 |
| B02 | src/mcp/commerce-web-server.ts / Gateway → CommerceProviderClient.searchWeb → POST responses | 外层有 Harness MCP 生命周期，但内部另发的模型请求仍由应用直接执行 | 已修：内部模型与搜索均由 App Server 执行，外层 MCP 返回原生事件来源及用量，无直接 Responses 模型请求 |

真实联调已取得 Spark 标题原生 Turn ID，以及搜索/打开页面 webSearch Items、来源 URL 和 token usage。模型目录来自固定的官方 Codex 源码，仅在标准 Responses 自定义供应商的搜索子任务中关闭不兼容的 Responses Lite 传输模式；未改任何模型名称或权重。

## 应保留的既有边界

- App Server 的 thread/*、turn/*、工具 Item、item/tool/call、item/tool/requestUserInput、原生权限请求、mcpServer/elicitation/request 保留各自协议身份；不另造 Agent loop、问题协议、对话历史或压缩器。
- 企业 RBAC、付费预算/审批、幂等、原始归档和结算是项目明确要求的业务服务职责；使用 Harness 不等于绕过它们。
- 本地 Qwen Embedding/Reranker 是 AGENTS.md 指定的数据检索组件，不作为第二个 Agent，不替代 Harness 做用户意图解释或工具调度。
- 协议枚举、严格 schema、主机工具禁用策略、固定模型/运行时版本和合成回归样本，不认定为应删除的业务硬编码。
- 0.42/0.55 是现有可配置服务默认值，市场 profile 可覆盖；不是 OpenAI/Qwen 官方准确率，也不是本次新增或调低的值。它们是否适合全部领域仍需标注集评估。

官方依据：[Codex App Server](https://developers.openai.com/codex/app-server) 的线程/Turn、动态工具、用户输入和 MCP elicitation 契约；[Codex open source](https://developers.openai.com/codex/open-source)。可用协议以仓库固定的 Codex 0.150.1 生成绑定和运行时为准，不直接照搬新版页面字段。

## 验证范围和限制

- 隔离运行的真实模型（相同固定 Qwen 权重）完整链路回归：24/24；涵盖主题、负样本、中文/英文/西语、排除、缺失/越界日期。
- 旧标注集保留：19/20，达到原有 90% 门槛，但“蘑菇勺/硅胶属性”一例仍不通过，不能称为模型零误判。
- 一次性 PostgreSQL 数据库应用既有 001–043 迁移，验证真实队列、租约、归档、结算、隔离及超过一万条记录遍历；新增源层/交付层诊断使用真实 pipeline + SQL readback。
- 原事故只读重评仍为 7 hold / 3 reject，3 条拒绝只标实际越界；修复普遍误杀不等于证明这批泛露营/餐饮/旅游内容都是合格锅具样本。
- 生产部署已应用迁移和策略回执；未重放供应商或改写原任务结果，116 条原始归档及其哈希、9 条不确定调用保持不变。多页统计按页面观察汇总，费用保留逐调用回执；原生模型用量使用线程累计值。

## 后续部署

先应用 044_research_policy_receipts.sql，再通过 external-data:import-research-policy 导入受校验 JSON。新任务执行版本为 3，旧任务不增加付费页。部署包含此前 v5 修复、Mac 模型逐请求 instruction 修复以及本次主数据/原生 Harness 调用改动；保留未知结果和所有原始归档。
