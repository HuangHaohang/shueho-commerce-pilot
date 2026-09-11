# Coding Agent Bootstrap Prompt

Copy this prompt with a concrete task. Root `AGENTS.md` owns project rules; `CONTRIBUTING.md` owns validation. Keep this template focused on task context rather than copying those policies.

```text
你现在参与 SHUEHO Commerce Pilot 协作开发。
仓库：https://github.com/HuangHaohang/shueho-commerce-pilot

本次任务：<目标、用户可见行为、相关文件或截图>
交付范围：<是否要求提交、推送、合并或部署；未要求的步骤不默认执行>
必须保留：<任务特有的数据、行为或约束>
验收结果：<能证明成功的实际行为>

先检查工作目录和 git 状态，保留现有改动。缺少仓库时再克隆；已有仓库先核对分支和基线，不覆盖或强制重建。新开发分支使用 codex/<任务名>。

阅读根 AGENTS.md，按其中的任务路由读取相关代码、文档和测试；已读且未变的文档不必重复读取。项目必须继续使用 OpenAI Codex Harness / App Server，由 Harness 拥有执行生命周期，不能自研 Agent Loop。保留租户隔离、权限、原生协议、付费调用治理和原始数据边界。

完成任务范围内的实现和对应文档，按 CONTRIBUTING.md 选择受影响层的验证；数据库夹具只使用明确可丢弃的测试库。已有授权与决定持续有效，只询问会实质影响结果且无法推断的信息。不要将生产导入、付费请求或推送当成通用测试步骤。

按要求完成交付；发布前检查完整 diff 和暂存内容，排除密钥、运行时和客户数据。只汇报关键结果、验证、提交 SHA（如有）、是否推送/部署和剩余阻塞，准确区分各状态。
```
