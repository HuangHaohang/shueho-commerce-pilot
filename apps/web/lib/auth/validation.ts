import { z } from "zod";

export const authIdentifierTypeSchema = z.enum(["email", "phone"]);

const passwordSchema = z
  .string()
  .min(8, "密码至少需要 8 个字符。")
  .max(128, "密码不能超过 128 个字符。")
  .regex(/[A-Za-z]/, "密码必须包含英文字母。")
  .regex(/\d/, "密码必须包含数字。");

export const loginBodySchema = z.object({
  identifierType: authIdentifierTypeSchema,
  identifier: z.string().trim().min(1).max(254),
  password: passwordSchema,
  rememberMe: z.boolean().optional().default(true),
});

export const registerBodySchema = loginBodySchema.extend({
  name: z.string().trim().min(1, "请输入名称。").max(50, "名称不能超过 50 个字符。"),
});

export function firstValidationError(error: z.ZodError): string {
  return error.issues[0]?.message || "提交的信息格式不正确。";
}
