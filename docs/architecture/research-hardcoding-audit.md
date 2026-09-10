# Research hardcoding and Codex Harness boundary audit

审查基线：b9933e33713cfa79e8f724a1786ca63bcd468686。范围为 src/、apps/external-data/src/、apps/web/lib/、services/local-retrieval-models/src/ 中的 216 个生产 TypeScript/Python 文件（排除测试、verify/evaluate 入口），另检查本次修改和相关评估入口。

本清单按“同一种规则”计数，不把每个常量、每行命中计为一个缺陷，也不声称是全仓所有硬编码的总数。确认 14 组研究/检索策略规则，以及另外 2 个内部模型执行旁路。H01–H08 在本次代码中修正；H09–H14 仍存在，不能称为全面清理完成。

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
| H09 | social-research-planner.ts / socialSortBinding, compareEndpointSpecificity | 写死两个排序枚举的意义，并按参数字段数挑接口 | 待处理：应有已审核的主数据能力映射；不能自行猜测新的替代映射 |
| H10 | social-research-planner.ts、endpoint-registry.ts、Gateway/托管说明 | 社交日期固定 +08:00/Asia/Shanghai | 待处理：当前中国时区契约不能冒充全球市场通用能力；迁移须以市场档案为依据 |
| H11 | canonical.ts、generic-normalizer.ts / defaultCommerceCurrency | 特定端点补默认参数；按五个平台名补 CNY | 待处理：参数/币种应由已导入契约和市场档案证明 |
| H12 | social-research-planner.ts、src/mcp/research-service.ts | 社交研究固定一次调用，没有目标覆盖驱动的已治理分页计划 | 未扩展付费行为：准确返回后续页和覆盖未完成；本次推导的“目标 N 条对应 N 页”及循环已撤回 |
| H13 | marketplace-workflow-execution.ts / representative selection | 同店惩罚 0.2、相关性/多样性权重 0.8/0.2 | 待处理：应有受审核采样策略和评估依据，不能称为 Harness 自带策略 |
| H14 | hybrid-search.ts、warehouse.ts | 检索候选固定 50/20，商品/品牌摘要固定 30、属性固定 50 | 待核定：包含性能/摘要上限，并非全部是错误；必须区分候选上限、预览上限和要求的样本覆盖 |

## 另外两个 Harness 执行旁路

| 编号 | 已核实调用链 | 边界事实 | 本次状态 |
| --- | --- | --- | --- |
| B01 | src/gateway/server.ts → CommerceProviderClient.generateThreadTitle → POST responses | 标题生成由应用直接请求模型，未通过 App Server 执行 | 已定位，未在研究修复中擅自迁移 |
| B02 | src/mcp/commerce-web-server.ts / Gateway → CommerceProviderClient.searchWeb → POST responses | 外层有 Harness MCP 生命周期，但内部另发的模型请求仍由应用直接执行 | 已定位，未修改已有搜索/计费/流式契约 |

这是代码路径事实；本次未付费调用这些模型验证生产效果。不能据此宣称整个系统已完全按 Harness 实现。

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
- 本次未改生产配置、未重放供应商、未更新原任务结果、未部署；上线和历史重评须保留原始响应哈希与旧决策修订。
