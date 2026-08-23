"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const contactSalesSchema = z.object({
  organization: z.string().trim().min(2, "请输入组织名称。").max(100, "组织名称不能超过 100 个字符。"),
  contactName: z.string().trim().min(1, "请输入联系人姓名。").max(50, "联系人姓名不能超过 50 个字符。"),
  workEmail: z.string().trim().email("请输入有效的工作邮箱。"),
  teamSize: z.enum(["under-10", "10-49", "50-199", "200-plus"], {
    message: "请选择预计使用规模。",
  }),
  primaryNeed: z.enum(["tenant", "rbac", "usage", "isolation", "concurrency", "audit"], {
    message: "请选择优先治理需求。",
  }),
  requirements: z
    .string()
    .trim()
    .min(10, "请用至少 10 个字符说明需求。")
    .max(1000, "需求说明不能超过 1000 个字符。"),
});

type ContactSalesFormValues = {
  organization: string;
  contactName: string;
  workEmail: string;
  teamSize: string;
  primaryNeed: string;
  requirements: string;
};

const fieldClassName =
  "mt-2 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3.5 text-sm text-[var(--cp-text)] outline-none transition-[border-color,box-shadow] duration-[var(--cp-duration-fast)] placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2";

export function EnterpriseContactForm() {
  const [submissionState, setSubmissionState] = useState<"idle" | "unconfigured">("idle");
  const {
    register,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors },
  } = useForm<ContactSalesFormValues>({
    defaultValues: {
      organization: "",
      contactName: "",
      workEmail: "",
      teamSize: "",
      primaryNeed: "",
      requirements: "",
    },
  });

  function validateWithoutSending(values: ContactSalesFormValues) {
    clearErrors();
    const parsed = contactSalesSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in values) {
          setError(field as keyof ContactSalesFormValues, { type: "validation", message: issue.message });
        }
      }
      return;
    }

    setSubmissionState("unconfigured");
  }

  return (
    <form
      noValidate
      className="space-y-6"
      onChange={() => {
        if (submissionState !== "idle") {
          setSubmissionState("idle");
        }
      }}
      onSubmit={handleSubmit(validateWithoutSending)}
      aria-describedby="enterprise-contact-channel-status"
    >
      <div
        id="enterprise-contact-channel-status"
        className="border-y border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-4 py-3 text-xs leading-5 text-[var(--cp-text-muted)]"
      >
        提交渠道尚未配置。此表单只在当前页面校验字段，不会发送或保存信息。
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="组织名称" error={errors.organization?.message} errorId="organization-error">
          <input
            {...register("organization")}
            type="text"
            autoComplete="organization"
            maxLength={100}
            aria-invalid={Boolean(errors.organization)}
            aria-describedby={errors.organization ? "organization-error" : undefined}
            className={cn(fieldClassName, "h-11")}
          />
        </FormField>

        <FormField label="联系人" error={errors.contactName?.message} errorId="contact-name-error">
          <input
            {...register("contactName")}
            type="text"
            autoComplete="name"
            maxLength={50}
            aria-invalid={Boolean(errors.contactName)}
            aria-describedby={errors.contactName ? "contact-name-error" : undefined}
            className={cn(fieldClassName, "h-11")}
          />
        </FormField>
      </div>

      <FormField label="工作邮箱" error={errors.workEmail?.message} errorId="work-email-error">
        <input
          {...register("workEmail")}
          type="email"
          autoComplete="email"
          inputMode="email"
          aria-invalid={Boolean(errors.workEmail)}
          aria-describedby={errors.workEmail ? "work-email-error" : undefined}
          className={cn(fieldClassName, "h-11")}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="预计使用规模" error={errors.teamSize?.message} errorId="team-size-error">
          <select
            {...register("teamSize")}
            aria-invalid={Boolean(errors.teamSize)}
            aria-describedby={errors.teamSize ? "team-size-error" : undefined}
            className={cn(fieldClassName, "h-11")}
          >
            <option value="">请选择</option>
            <option value="under-10">少于 10 人</option>
            <option value="10-49">10–49 人</option>
            <option value="50-199">50–199 人</option>
            <option value="200-plus">200 人及以上</option>
          </select>
        </FormField>

        <FormField label="优先治理需求" error={errors.primaryNeed?.message} errorId="primary-need-error">
          <select
            {...register("primaryNeed")}
            aria-invalid={Boolean(errors.primaryNeed)}
            aria-describedby={errors.primaryNeed ? "primary-need-error" : undefined}
            className={cn(fieldClassName, "h-11")}
          >
            <option value="">请选择</option>
            <option value="tenant">独立租户</option>
            <option value="rbac">工作区与 RBAC</option>
            <option value="usage">用量治理</option>
            <option value="isolation">安全隔离</option>
            <option value="concurrency">并发策略</option>
            <option value="audit">审计记录</option>
          </select>
        </FormField>
      </div>

      <FormField label="需求说明" error={errors.requirements?.message} errorId="requirements-error">
        <textarea
          {...register("requirements")}
          rows={5}
          maxLength={1000}
          placeholder="例如：工作区数量、角色边界、并发规模或审计要求"
          aria-invalid={Boolean(errors.requirements)}
          aria-describedby={errors.requirements ? "requirements-error" : undefined}
          className={cn(fieldClassName, "min-h-[124px] resize-y py-3 leading-6")}
        />
      </FormField>

      {submissionState === "unconfigured" ? (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-3 border-y border-[var(--cp-border)] bg-[var(--cp-warning-bg)] px-4 py-3 text-sm leading-6 text-[var(--cp-text-soft)]"
        >
          <CircleAlert className="mt-1 size-4 shrink-0 text-[var(--cp-warning)]" strokeWidth={1.8} />
          <span>当前未配置销售 CRM 或投递渠道，以上信息未发送、未保存。接入正式渠道后才能完成联系请求。</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button type="submit" size="lg" className="rounded-full">
          联系销售团队
        </Button>
        <span className="text-xs leading-5 text-[var(--cp-text-faint)]">点击后仅验证字段并显示渠道状态。</span>
      </div>
    </form>
  );
}

function FormField({
  label,
  error,
  errorId,
  children,
}: {
  label: string;
  error?: string;
  errorId: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-[var(--cp-text-soft)]">
      <span>{label}</span>
      {children}
      {error ? (
        <span id={errorId} className="mt-1.5 block text-xs font-normal leading-5 text-[var(--cp-danger)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}
