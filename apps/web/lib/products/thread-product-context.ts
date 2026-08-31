import { z } from "zod";

const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const threadProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  spu: z.string().min(1).max(255),
  status: z.enum(["draft", "active", "archived"]),
  variantCount: z.number().int().nonnegative(),
  sourceName: z.string().min(1).max(160),
  updatedAt: z.string().datetime({ offset: true }),
  imageUrl: z.string().url().nullable(),
}).strict();

export const threadProductContextSchema = z.object({
  turnId: z.string().regex(THREAD_ID_PATTERN).nullable(),
  products: z.array(threadProductSchema).max(20),
  resolvedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.turnId === null && value.products.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "未绑定 Turn 的任务不能恢复产品。",
      path: ["products"],
    });
  }
  if (value.turnId !== null && value.products.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "已绑定产品 Turn 必须包含产品摘要。",
      path: ["products"],
    });
  }
});

export type ThreadProduct = z.infer<typeof threadProductSchema>;
export type ThreadProductContext = z.infer<typeof threadProductContextSchema>;

export class ThreadProductContextRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ThreadProductContextRequestError";
  }
}

export async function getThreadProductContext(
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadProductContext> {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new ThreadProductContextRequestError(
      "任务标识无效。",
      400,
      "PRODUCT_CONTEXT_THREAD_INVALID",
    );
  }

  const response = await fetch(
    `/api/agent/threads/${encodeURIComponent(threadId)}/product-context`,
    { cache: "no-store", signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const record = isRecord(payload) ? payload : null;
    throw new ThreadProductContextRequestError(
      typeof record?.error === "string" && record.error.trim()
        ? record.error
        : "无法恢复任务的产品上下文。",
      response.status,
      typeof record?.code === "string" && record.code.trim()
        ? record.code
        : "PRODUCT_CONTEXT_REQUEST_FAILED",
    );
  }

  const parsed = threadProductContextSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ThreadProductContextRequestError(
      "产品上下文接口返回了无法识别的数据。",
      502,
      "PRODUCT_CONTEXT_INVALID_RESPONSE",
    );
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
