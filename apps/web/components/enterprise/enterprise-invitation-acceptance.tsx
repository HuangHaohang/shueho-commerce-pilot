"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AuthUser = {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  displayIdentifier: string;
};

type AuthSessionResponse = {
  user: AuthUser | null;
};

type AuthMode = "login" | "register";
type TokenState = "reading" | "available" | "missing";
type AcceptanceState = "idle" | "accepting" | "accepted";

const invitationCredentialsSchema = z.object({
  email: z.string().trim().email("请输入邀请对应的工作邮箱。").max(254, "邮箱地址过长。"),
  password: z
    .string()
    .min(8, "密码至少需要 8 个字符。")
    .max(128, "密码不能超过 128 个字符。")
    .regex(/[A-Za-z]/, "密码必须包含英文字母。")
    .regex(/\d/, "密码必须包含数字。"),
});

const invitationAuthSchema = invitationCredentialsSchema.extend({
  name: z.string().trim().min(1, "请输入名称。").max(50, "名称不能超过 50 个字符。"),
});

type InvitationAuthValues = z.infer<typeof invitationAuthSchema>;

const fieldClassName =
  "mt-2 h-11 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3.5 text-sm text-[var(--cp-text)] outline-none transition-[border-color,box-shadow] duration-[var(--cp-duration-fast)] placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2";

export function EnterpriseInvitationAcceptance() {
  const tokenRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const [tokenState, setTokenState] = useState<TokenState>("reading");
  const [acceptanceState, setAcceptanceState] = useState<AcceptanceState>("idle");
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    enabled: tokenState === "available",
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("token");
    window.history.replaceState(window.history.state, "", "/invite");
    if (token && token.length >= 32 && token.length <= 512) {
      tokenRef.current = token;
      setTokenState("available");
    } else {
      setTokenState("missing");
    }
  }, []);

  async function acceptInvitation() {
    const token = tokenRef.current;
    if (!token || !sessionQuery.data?.user) return;
    setAcceptanceState("accepting");
    setAcceptanceError(null);
    try {
      const response = await fetch("/api/enterprise/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => null)) as { accepted?: boolean; error?: string } | null;
      if (!response.ok || payload?.accepted !== true) {
        throw new Error(payload?.error || "无法接受企业邀请。");
      }
      tokenRef.current = null;
      setAcceptanceState("accepted");
    } catch (error) {
      setAcceptanceState("idle");
      setAcceptanceError(error instanceof Error ? error.message : "无法接受企业邀请。");
    }
  }

  async function switchAccount() {
    await fetch("/api/account/logout", { method: "POST" });
    setAcceptanceError(null);
    setAcceptanceState("idle");
    await sessionQuery.refetch();
  }

  return (
    <div className="min-h-dvh bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <header className="border-b border-[var(--cp-border-subtle)]">
        <div className="mx-auto flex h-[var(--cp-topbar-height)] max-w-[760px] items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            返回工作台
          </Link>
          <span className="text-sm font-semibold">Enterprise</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] px-5 pb-20 pt-12 md:px-8 md:pt-16">
        <div className="flex items-center gap-2 text-sm text-[var(--cp-text-muted)]">
          <ShieldCheck className="size-4" strokeWidth={1.8} />
          企业工作区邀请
        </div>
        <h1 className="mb-0 mt-4 text-[28px] font-semibold leading-tight md:text-[32px]">接受 Commerce Pilot 邀请</h1>
        <p className="mb-0 mt-4 max-w-[600px] text-sm leading-6 text-[var(--cp-text-muted)]">
          邀请与指定工作邮箱绑定。登录或创建对应账号后，再明确确认加入企业租户和工作区。
        </p>

        <section className="mt-9 border-y border-[var(--cp-border)] py-8" aria-live="polite">
          {tokenState === "reading" || (tokenState === "available" && sessionQuery.isLoading) ? (
            <InvitationSkeleton />
          ) : null}
          {tokenState === "missing" ? <MissingInvitation /> : null}
          {tokenState === "available" && sessionQuery.isError ? (
            <InvitationError
              title="无法检查登录状态"
              message="认证服务暂时不可用，请稍后重新读取。"
              onRetry={() => void sessionQuery.refetch()}
            />
          ) : null}
          {tokenState === "available" && sessionQuery.data && acceptanceState === "accepted" ? (
            <AcceptedInvitation user={sessionQuery.data.user} />
          ) : null}
          {tokenState === "available" && sessionQuery.data && acceptanceState !== "accepted" ? (
            sessionQuery.data.user ? (
              <SignedInAcceptance
                user={sessionQuery.data.user}
                accepting={acceptanceState === "accepting"}
                error={acceptanceError}
                onAccept={acceptInvitation}
                onSwitchAccount={switchAccount}
              />
            ) : (
              <InvitationAuthentication
                invitationToken={tokenRef.current || ""}
                onAuthenticated={() => sessionQuery.refetch().then(() => undefined)}
              />
            )
          ) : null}
        </section>

        <div className="mt-6 flex items-start gap-3 text-xs leading-5 text-[var(--cp-text-faint)]">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
          <p className="m-0">
            邀请 token 通过不会发送到服务器的 URL fragment 进入本页，只在内存中用于本次接受请求；读取后立即从地址栏移除，不写入浏览器存储或页面日志。
          </p>
        </div>
      </main>
    </div>
  );
}

function SignedInAcceptance({
  user,
  accepting,
  error,
  onAccept,
  onSwitchAccount,
}: {
  user: AuthUser;
  accepting: boolean;
  error: string | null;
  onAccept: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
}) {
  return (
    <div>
      <p className="m-0 text-sm font-medium">确认登录邮箱</p>
      <dl className="mb-0 mt-5 border-y border-[var(--cp-border-subtle)]">
        <div className="grid gap-1 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
          <dt className="text-sm text-[var(--cp-text-muted)]">当前账号</dt>
          <dd className="m-0 break-all text-sm">{user.email || user.displayIdentifier}</dd>
        </div>
        <div className="grid gap-1 border-t border-[var(--cp-border-subtle)] py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
          <dt className="text-sm text-[var(--cp-text-muted)]">校验规则</dt>
          <dd className="m-0 text-sm leading-6">当前邮箱必须与邀请指定邮箱完全匹配。</dd>
        </div>
      </dl>
      {error ? (
        <p role="alert" className="mb-0 mt-5 text-sm leading-6 text-[var(--cp-danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void onAccept()} disabled={accepting || !user.email}>
          {accepting ? <Loader2 className="animate-spin" /> : <Check />}
          {accepting ? "正在接受" : "接受邀请"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void onSwitchAccount()} disabled={accepting}>
          切换账号
        </Button>
      </div>
      {!user.email ? (
        <p className="mb-0 mt-4 text-xs leading-5 text-[var(--cp-warning)]">
          当前账号没有可用于邀请校验的工作邮箱，请切换账号。
        </p>
      ) : null}
    </div>
  );
}

function InvitationAuthentication({
  invitationToken,
  onAuthenticated,
}: {
  invitationToken: string;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<InvitationAuthValues>({ defaultValues: { email: "", password: "", name: "" } });

  async function authenticate(values: InvitationAuthValues) {
    clearErrors();
    setRequestError(null);
    const parsed =
      mode === "register"
        ? invitationAuthSchema.safeParse(values)
        : invitationCredentialsSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email" || field === "password" || field === "name") {
          setError(field, { type: "validation", message: issue.message });
        }
      }
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/account/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifierType: "email",
          identifier: values.email,
          password: values.password,
          rememberMe: true,
          ...(mode === "register" ? { name: values.name, invitationToken } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "认证请求失败，请稍后重试。");
      await onAuthenticated();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "认证请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setRequestError(null);
    clearErrors();
  }

  return (
    <form noValidate onSubmit={handleSubmit(authenticate)}>
      <div className="inline-flex rounded-full bg-[var(--cp-bg-subtle)] p-1" role="group" aria-label="账号操作">
        <button
          type="button"
          className={cn(
            "h-8 rounded-full px-4 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
            mode === "login" ? "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]" : "text-[var(--cp-text-muted)]",
          )}
          onClick={() => changeMode("login")}
        >
          登录
        </button>
        <button
          type="button"
          className={cn(
            "h-8 rounded-full px-4 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
            mode === "register" ? "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]" : "text-[var(--cp-text-muted)]",
          )}
          onClick={() => changeMode("register")}
        >
          创建受邀账号
        </button>
      </div>

      <p className="mb-0 mt-5 text-sm leading-6 text-[var(--cp-text-muted)]">
        请使用收到邀请的工作邮箱。创建账号时会在请求体中一次性校验邀请；登录已有账号时不会发送邀请 token。
      </p>

      <div className="mt-6 space-y-5">
        {mode === "register" ? (
          <FormField label="名称" error={errors.name?.message} errorId="invite-auth-name-error">
            <input
              {...register("name")}
              type="text"
              autoComplete="name"
              className={fieldClassName}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "invite-auth-name-error" : undefined}
            />
          </FormField>
        ) : null}
        <FormField label="工作邮箱" error={errors.email?.message} errorId="invite-auth-email-error">
          <input
            {...register("email")}
            type="email"
            autoComplete="email"
            inputMode="email"
            className={fieldClassName}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "invite-auth-email-error" : undefined}
          />
        </FormField>
        <FormField label="密码" error={errors.password?.message} errorId="invite-auth-password-error">
          <div className="relative">
            <input
              {...register("password")}
              type={passwordVisible ? "text" : "password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={cn(fieldClassName, "pr-11")}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "invite-auth-password-error" : undefined}
            />
            <button
              type="button"
              className="absolute bottom-1 right-1 flex size-9 items-center justify-center rounded-[var(--cp-radius-item)] text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              onClick={() => setPasswordVisible((current) => !current)}
            >
              {passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>
      </div>

      {requestError ? (
        <p role="alert" className="mb-0 mt-5 text-sm text-[var(--cp-danger)]">
          {requestError}
        </p>
      ) : null}

      <Button type="submit" className="mt-6" disabled={submitting}>
        {submitting ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
        {submitting ? "正在验证" : mode === "login" ? "登录后继续" : "创建账号后继续"}
      </Button>
    </form>
  );
}

function AcceptedInvitation({ user }: { user: AuthUser | null }) {
  return (
    <div>
      <span className="flex size-9 items-center justify-center rounded-full bg-[var(--cp-success-bg)] text-[var(--cp-success)]">
        <Check className="size-4" strokeWidth={2} />
      </span>
      <h2 className="mb-0 mt-5 text-[20px] font-semibold">已加入企业工作区</h2>
      <p className="mb-0 mt-3 text-sm leading-6 text-[var(--cp-text-muted)]">
        {user?.email
          ? `${user.email} 的成员资格和角色已写入；进入工作台后会按新权限重新读取上下文。`
          : "成员资格和角色已写入；进入工作台后会按新权限重新读取上下文。"}
      </p>
      <Button asChild className="mt-6">
        <Link href="/">进入工作台</Link>
      </Button>
    </div>
  );
}

function MissingInvitation() {
  return (
    <div>
      <h2 className="m-0 text-[20px] font-semibold">邀请链接无效</h2>
      <p className="mb-0 mt-3 text-sm leading-6 text-[var(--cp-text-muted)]">
        链接未包含有效 token。请让企业管理员重新创建邀请，并使用完整链接打开本页。
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">返回工作台</Link>
      </Button>
    </div>
  );
}

function InvitationError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div>
      <h2 className="m-0 text-[20px] font-semibold">{title}</h2>
      <p className="mb-0 mt-3 text-sm text-[var(--cp-text-muted)]">{message}</p>
      <Button type="button" variant="outline" className="mt-6" onClick={onRetry}>
        重新读取
      </Button>
    </div>
  );
}

function InvitationSkeleton() {
  return (
    <div className="animate-pulse" aria-label="正在检查邀请和登录状态">
      <div className="h-5 w-32 rounded bg-[var(--cp-bg-muted)]" />
      <div className="mt-5 h-11 w-full rounded bg-[var(--cp-bg-muted)]" />
      <div className="mt-4 h-11 w-full rounded bg-[var(--cp-bg-muted)]" />
    </div>
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
      {label}
      {children}
      {error ? (
        <span id={errorId} className="mt-1.5 block text-xs font-normal text-[var(--cp-danger)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

async function getAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/account/session", { cache: "no-store" });
  if (!response.ok) throw new Error("认证服务暂时不可用。");
  return (await response.json()) as AuthSessionResponse;
}
