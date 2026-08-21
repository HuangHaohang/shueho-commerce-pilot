import type { Metadata } from "next";

import {
  LegalDocumentLayout,
  LegalSection,
  LegalSourceList,
} from "@/components/legal/legal-document-layout";

export const metadata: Metadata = {
  title: "AI 使用说明 | Commerce Pilot",
  description: "Commerce Pilot AI 使用、审核、模型改进与内容标识说明。",
};

export default function AiNoticePage() {
  return (
    <LegalDocumentLayout
      title="AI 使用说明"
      lead="Commerce Pilot 是 AI 驱动的电商工作助手，不是自然人。此页面说明 AI 如何生成内容、对话为何可能被审核，以及您应如何安全地核验和使用结果。"
    >
      <LegalSection title="一、您正在与 AI 交互">
        <p>
          Commerce Pilot 使用生成式人工智能模型理解请求、生成回复、规划任务和调用获准工具。回复由模型自动生成，可能不是事实陈述，也不代表运营主体、模型提供方或任何第三方作出的承诺。
        </p>
      </LegalSection>

      <LegalSection title="二、AI 能做什么">
        <ul>
          <li>解释和整理电商运营、商品、订单、库存、售后及报表信息；</li>
          <li>根据您提供的上下文起草方案、总结差异并建议下一步；</li>
          <li>在您授权的范围内调用外部系统，并展示审批、执行状态和读回结果；</li>
          <li>协助生成文本、表格、代码或其他工作成果。</li>
        </ul>
      </LegalSection>

      <LegalSection title="三、AI 的局限">
        <p>
          AI 可能生成不准确、不完整、过时、带有偏差或无法验证的内容，也可能误解平台规则、业务口径和您未提供的背景。请核对关键数字、对象编号、时间范围、数据来源和目标系统最终回执。
        </p>
        <p>
          涉及财务、税务、法律、医疗、人事、平台处罚或其他高影响决定时，请让具备相应资质或权限的人员复核。不要仅凭 AI 回复自动作出对个人权益有重大影响的决定。
        </p>
      </LegalSection>

      <LegalSection title="四、对话审核与模型改进">
        <p>
          部分对话可能通过自动化方式或由经过授权的人员进行有限审核，用于识别违法有害内容、调查滥用、排查故障、评估回复质量或改进 AI 模型。相关处理遵循最小必要、访问控制和保存期限限制。
        </p>
        <p>
          在模型改进用途实际启用前，产品将说明适用范围并提供相应控制方式。除法律另有规定或取得单独同意外，不会将属于敏感个人信息的交互数据用于模型训练。第三方系统访问凭证不会用于模型训练。详情请查阅《隐私政策》。
        </p>
      </LegalSection>

      <LegalSection title="五、请不要输入不必要的敏感内容">
        <p>
          请避免输入身份证件、银行卡、精确住址、医疗健康、未成年人信息、账号密码、访问令牌，以及与任务无关的客户个人信息或未公开商业秘密。确需处理时，应确认来源合法、目的明确、范围必要，并采用脱敏、最小字段和最小权限方式。
        </p>
      </LegalSection>

      <LegalSection title="六、工具调用与外部操作">
        <p>
          AI 的计划不等于操作已完成。对订单、价格、库存、退款、营销等外部写操作，请查看目标对象、变更字段、权限范围和风险说明，并在需要时完成明确审批。执行后应以目标系统读回记录和业务回执作为完成依据。
        </p>
      </LegalSection>

      <LegalSection title="七、生成内容标识">
        <p>
          界面会持续提示您正在使用 AI。对依法需要标识的生成文本、图片、音频、视频或虚拟场景，正式提供生成、下载、复制或导出功能时，将按适用规则添加显式或隐式标识。您不得恶意删除、篡改、伪造或隐匿依法添加的标识。
        </p>
      </LegalSection>

      <LegalSection title="八、反馈、申诉与人工支持">
        <p>
          如您发现错误输出、违法有害内容、个人信息问题或未经授权的操作，应停止继续执行并保存相关任务记录。反馈、申诉、投诉和人工支持入口将在正式上线前于产品内公示。
        </p>
      </LegalSection>

      <LegalSection title="主要规则依据">
        <LegalSourceList
          sources={[
            {
              label: "《生成式人工智能服务管理暂行办法》",
              href: "https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm",
            },
            {
              label: "《人工智能生成合成内容标识办法》",
              href: "https://www.nrta.gov.cn/art/2025/3/14/art_113_70340.html?xxgkhide=1",
            },
            {
              label: "GB 45438-2025《网络安全技术 人工智能生成合成内容标识方法》",
              href: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F32EA2A561F1886CD8D606513512D547&refer=outter",
            },
            {
              label: "生成式人工智能服务备案信息公告",
              href: "https://www.cac.gov.cn/2024-04/02/c_1713729983803145.htm",
            },
          ]}
        />
      </LegalSection>
    </LegalDocumentLayout>
  );
}
