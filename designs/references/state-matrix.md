# State Matrix

## App Runtime

| State | Source | UI | Allowed Actions |
|---|---|---|---|
| `booting` | app init | 保留 shell skeleton | 无写操作 |
| `ready` | gateway health ok | 正常工作台 | 发起任务 |
| `gateway_unavailable` | `/health` failed | 主区错误面板，侧栏保留 | 重试、查看诊断 |
| `codex_unavailable` | health codex false | Codex runtime 不可用 | 重试、查看配置状态 |
| `unauthenticated` | auth/session 401 | 单行访客 composer、登录入口，隐藏项目选择和 runtime 状态 | 提问、登录 |
| `permission_denied` | API 403 | 权限说明，不自动重试 | 切换账号、请求授权 |

## Authentication

| State | UI | Allowed Actions |
|---|---|---|
| `signed_out` | 访客 composer、登录和免费注册入口 | 登录、注册、访客提问 |
| `submitting` | 登录弹窗控件保持尺寸，主按钮显示 loader | 关闭弹窗 |
| `invalid_credentials` | 表单内显示通用账号或密码错误 | 修改后重试 |
| `authenticated` | 显示账户摘要、退出登录和完整工作 composer | 使用工作台、退出 |
| `auth_unavailable` | 表单内显示认证服务暂不可用 | 稍后重试 |

验证码登录属于后续状态，本阶段禁止展示无法完成的验证码入口。

## Model Configuration

| State | UI |
|---|---|
| GPT model | 显示模型名、彩色推理强度、可拖动 slider 和高级模型/推理菜单 |
| Non-GPT model | 只显示模型名和模型菜单，隐藏所有推理强度控件 |
| Catalog loading | 模型 pill 保持尺寸并显示“加载模型” |
| Catalog unavailable | 保留当前选择，高级模型菜单显示不可用状态 |

## Thread Lifecycle

| State | Meaning | UI |
|---|---|---|
| `idle` | 无活动 thread | 未登录显示单行访客 composer；已登录显示工作 composer |
| `creating` | 正在创建 thread | composer loading，禁重复提交 |
| `active` | thread 已创建 | 输出区显示消息和事件 |
| `streaming` | Codex 正在执行 | 显示实时递增的“正在处理 X 秒”；当前 turn 正文按 sequence 更新，命令/文件/工具共用单一扫光活动槽并原位替换，submit 变 stop，模型与推理强度控件 disabled |
| `background_streaming` | 用户切换到另一 thread，但原 thread 仍有 active turn | 后台 turn 继续执行，侧栏显示旋转图标；不再把事件渲染到当前正文，切回后恢复并订阅 |
| `waiting_approval` | 需要人工批准 | 展开 ApprovalPanel |
| `waiting_input` | 需要用户补充信息 | composer 聚焦并显示请求来源 |
| `interrupted` | 用户停止或系统中断 | 显示继续/重新运行 |
| `completed` | turn 完成 | 耗时冻结为“已处理 X 秒”；只显示最终正文，当前 turn 活动归并为默认收起、可展开的 disclosure |
| `failed` | turn 失败 | 显示分类错误和重试策略 |
| `history_loading` | 用户刷新或选择历史 thread | 保留 shell 尺寸，读取用户所有权索引并从 App Server 恢复 turns；禁止显示其他用户 thread |
| `history_missing` | 索引存在但 App Server rollout 已不存在 | 删除失效索引、返回新任务并提示记录不可恢复；不得继续向失效 thread 发送 turn |

## Tool And Commerce Action

| State | Meaning | UI Rule |
|---|---|---|
| `draft` | agent 生成待执行计划 | 只显示草案，不出现“已执行”暗示 |
| `approval_pending` | 需要人类批准 | ApprovalPanel 必须展开 |
| `approved` | 用户已批准 | 记录批准人、时间和范围 |
| `running` | 正在调用外部系统 | 展示目标系统和对象编号 |
| `write_succeeded` | 上游返回写入成功 | 仍标记“待读回验证” |
| `readback_pending` | 正在读取验证 | 显示验证中 |
| `verified` | 读回证明匹配 | 显示完成、来源、时间 |
| `readback_failed` | 无法确认写入结果 | 显示风险，不当作成功 |
| `rejected` | 用户拒绝 | 标记未执行 |
| `failed` | 调用失败 | 显示错误分类和可恢复动作 |

## Commerce Object

| State | UI |
|---|---|
| `loading` | stable skeleton，保留高度 |
| `empty` | 一行空状态 + 可选创建/同步动作 |
| `loaded` | 对象预览或列表 |
| `stale` | 弱提示“数据可能已过期”，提供重新读取 |
| `conflict` | 显示冲突字段和来源，不自动覆盖 |
| `permission_denied` | 显示无权限，不隐藏为无数据 |
| `not_found` | 显示对象不存在或已删除 |
| `dependency_failed` | 显示外部系统异常和 request id |

## Connection And Streaming

| State | Trigger | UI |
|---|---|---|
| `connected` | SSE open | 不打扰 |
| `reconnecting` | SSE close/error | 顶部或事件流弱提示 |
| `disconnected` | retry exhausted | 提供手动重连 |
| `event_gap` | cursor mismatch | 提示刷新 thread，不自动重复写操作 |
| `runtime_restarted` | 活动 turn 之后的新健康采样显示 App Server 未运行/未初始化 | 立即冻结耗时、清除停止态、把活动 item 标为未完成，并提示重新发送；不得继续客户端计时 |

## Approval Risk Levels

| Level | Examples | UI |
|---|---|---|
| `info` | 读取公开商品信息、生成报表草案 | 普通边框 |
| `low` | 更新本地草稿、添加内部备注 | 普通确认 |
| `medium` | 修改库存预警、调整商品内容 | ApprovalPanel |
| `high` | 改价、取消订单、同意退款、批量同步 | ApprovalPanel + 明确影响范围 |
| `blocked` | 缺少权限、缺少读回能力、数据冲突未解决 | 禁止执行，说明解除条件 |

## Error Copy Rules

错误文案必须包含：

- 人能理解的短标题。
- 发生在哪个系统或步骤。
- 用户可执行动作。
- 可复制 `requestId` 或内部 trace id。

错误文案不得包含：

- raw token。
- provider secret。
- 完整手机号、地址、身份证、支付信息。
- 上游完整堆栈。
