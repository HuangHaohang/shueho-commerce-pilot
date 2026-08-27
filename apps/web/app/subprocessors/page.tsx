import type { Metadata } from "next";

import {
  LegalDocumentLayout,
  LegalSection,
  LegalSourceList,
} from "@/components/legal/legal-document-layout";

export const metadata: Metadata = {
  title: "第三方服务清单 | Commerce Pilot",
  description: "Commerce Pilot 当前第三方模型、数据接口和基础设施类别。",
};

export default function SubprocessorsPage() {
  return (
    <LegalDocumentLayout
      title="第三方服务清单"
      lead="此清单说明 Commerce Pilot 功能可能依赖的第三方服务类别、处理目的和数据范围。实际生产部署必须补充签约主体、服务区域、数据保存和跨境状态；未完成核验的第三方不得接收个人信息或未公开商业数据。"
    >
      <LegalSection title="一、JustOneAPI">
        <ul>
          <li><strong>用途：</strong>查询电商、社交平台及其他公开市场数据，支持市场调研和竞争分析。</li>
          <li><strong>可能发送：</strong>接口标识、查询关键词、商品、内容、店铺或创作者的公开标识，以及完成请求所需的分页和筛选参数。</li>
          <li><strong>不会发送：</strong>Commerce Pilot 密码、会话 Cookie、内部 MCP Token、JustOneAPI Token、企业 RBAC 详情或与请求无关的客户数据。</li>
          <li><strong>接收：</strong>第三方平台返回的公开数据、业务码和分页信息。</li>
          <li><strong>区域与保存：</strong>以双方合同和 JustOneAPI 实际部署为准；未核实数据接收地区和个人信息处理条件前，不得提交个人信息或敏感业务数据。</li>
        </ul>
        <p>
          JustOneAPI 当前公开隐私政策重点说明其公开网站的访问归因，并明确账户、计费和 API 请求可能涉及该页面未描述的额外运营系统；因此该公开页面不能替代生产接入所需的数据处理协议、服务区域、保存期限和安全措施确认。
        </p>
        <LegalSourceList
          sources={[
            { label: "JustOneAPI API 文档", href: "https://docs.justoneapi.com/zh/" },
            { label: "JustOneAPI 服务条款", href: "https://justoneapi.com/zh/terms" },
            { label: "JustOneAPI 隐私政策", href: "https://justoneapi.com/zh/privacy" },
          ]}
        />
      </LegalSection>

      <LegalSection title="二、模型与搜索提供方">
        <p>
          Commerce Pilot 通过企业部署配置的 OpenAI-compatible 模型提供方完成模型推理、网页搜索和图片生成。可能发送完成任务所需的提示词、受控上下文、附件提取内容和工具结果；供应商凭据保留在服务端。具体签约主体、模型、区域、保存和训练用途必须在生产环境的合同与隐私披露中据实列明，不能仅使用“兼容接口”替代披露。
        </p>
      </LegalSection>

      <LegalSection title="三、托管、数据库与身份服务">
        <p>
          PostgreSQL、应用托管、对象存储、邮件、短信、安全监测和客户支持供应商只有在正式配置后才构成实际受托处理者。当前仓库不预设生产供应商；部署负责人必须建立供应商台账、数据处理协议、访问控制、删除机制、事件通知和退出迁移安排后再更新本清单。
        </p>
      </LegalSection>

      <LegalSection title="四、变更通知">
        <p>
          新增会接收个人信息、业务数据或任务内容的第三方服务前，应完成安全与个人信息保护评估，更新本清单和隐私政策，并在依法需要时取得同意。替换供应商不得降低已经承诺的权限、保存、地域和安全控制。
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
