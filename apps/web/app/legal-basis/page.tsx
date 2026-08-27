import type { Metadata } from "next";

import {
  LegalDocumentLayout,
  LegalSection,
  LegalSourceList,
} from "@/components/legal/legal-document-layout";

export const metadata: Metadata = {
  title: "合规依据 | Commerce Pilot",
  description: "Commerce Pilot 数据、AI、外部接口与电商场景的主要合规依据。",
};

export default function LegalBasisPage() {
  return (
    <LegalDocumentLayout
      title="合规依据"
      lead="本页面将 Commerce Pilot 当前功能映射到中华人民共和国大陆地区现行主要法律法规和监管规则，用于产品设计、权限、审计和数据治理基线。它不是律师出具的法律意见，实际适用仍取决于运营主体、用户范围、数据类型、部署地区和具体业务流程。"
    >
      <LegalSection title="一、个人信息与网络数据">
        <p>
          账号、对话、附件、外部连接和业务数据处理以目的明确、最小必要、公开透明、权限隔离和最短必要保存为基线。涉及敏感个人信息、向其他处理者提供或跨境处理时，应根据实际情形履行单独同意、影响评估、合同、安全评估或其他法定程序。
        </p>
        <LegalSourceList
          sources={[
            { label: "《中华人民共和国个人信息保护法》", href: "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm" },
            { label: "《中华人民共和国数据安全法》", href: "https://www.npc.gov.cn/npc/c2/c30834/202106/t20210610_311888.html" },
            { label: "《网络数据安全管理条例》", href: "https://app.www.gov.cn/govdata/gov/202409/30/520076/article.html" },
            { label: "《个人信息保护合规审计管理办法》", href: "https://www.cac.gov.cn/2025-02/14/c_1741233507681519.htm" },
          ]}
        />
      </LegalSection>

      <LegalSection title="二、生成式人工智能与内容标识">
        <p>
          产品应明确用户正在与 AI 交互，保护输入和使用记录，处理违法有害内容，并对依法需要标识的生成文本、图片、音频和视频实施显式或隐式标识。当前代码和页面只能构成技术准备，备案、许可、算法或内容标识义务仍须按正式运营形态逐项确认。
        </p>
        <p>
          现行《人工智能拟人化互动服务管理暂行办法》自 2026 年 7 月 15 日施行，但其第二条明确：不涉及持续性情感互动的智能客服、知识问答、工作助手和科学研究服务不适用。Commerce Pilot 当前定位为电商工作助手，不设计情感陪伴、人格模拟或依赖诱导；若产品方向发生变化，必须重新完成适用性、安全评估和备案审查。
        </p>
        <LegalSourceList
          sources={[
            { label: "《生成式人工智能服务管理暂行办法》", href: "https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm" },
            { label: "《人工智能生成合成内容标识办法》", href: "https://www.cac.gov.cn/2025-03/14/c_1743654685899683.htm" },
            { label: "《人工智能拟人化互动服务管理暂行办法》", href: "https://www.cac.gov.cn/2026-04/10/c_1777558395078289.htm" },
            { label: "GB 45438-2025《网络安全技术 人工智能生成合成内容标识方法》", href: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F32EA2A561F1886CD8D606513512D547&refer=outter" },
          ]}
        />
      </LegalSection>

      <LegalSection title="三、电商、市场调研与消费者权益">
        <p>
          电商经营、市场调研和内容生成应遵守公平诚信、知识产权、消费者权益、个人信息和平台规则。公开可访问不当然等于可以无限制收集、再分发或用于识别个人；用户和运营主体仍需确认数据来源、平台合同与具体使用目的的合法性。
        </p>
        <LegalSourceList
          sources={[
            { label: "《中华人民共和国电子商务法》", href: "https://www.samr.gov.cn/wljys/gzzd/art/2023/art_3e75434c954b4cb9bd14867dacff26d1.html" },
            { label: "《中华人民共和国消费者权益保护法实施条例》", href: "https://app.www.gov.cn/govdata/gov/202403/19/513111/article.html" },
            { label: "JustOneAPI 服务条款", href: "https://justoneapi.com/zh/terms" },
          ]}
        />
      </LegalSection>

      <LegalSection title="四、当前上线门禁">
        <ul>
          <li>运营主体、统一社会信用代码、注册地址、客服和个人信息保护联系方式必须真实配置；</li>
          <li>JustOneAPI 允许多租户 SaaS 代理使用、商业计费和数据再分发的范围应取得书面确认；</li>
          <li>第三方处理者、数据接收地区、跨境路径和保存期限必须按实际部署完成核验与披露；</li>
          <li>AI 备案、算法、内容标识、等保、合规审计和行业许可义务应由具备资质的法律与安全人员按正式业务评估；</li>
          <li>未经上述核验，本仓库的法律页面、权限和审计功能不得被表述为已经完成全部法定合规。</li>
        </ul>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
