export type VerificationPurpose = "sign-in" | "register" | "reset-password" | "verify-contact";

export type EmailVerificationMessage = {
  to: string;
  code: string;
  purpose: VerificationPurpose;
  expiresInSeconds: number;
};

export type SmsVerificationMessage = {
  to: string;
  code: string;
  purpose: VerificationPurpose;
  expiresInSeconds: number;
};

export interface EmailVerificationSender {
  readonly provider: string;
  send(message: EmailVerificationMessage): Promise<void>;
}

export interface SmsVerificationSender {
  readonly provider: string;
  send(message: SmsVerificationMessage): Promise<void>;
}

export class VerificationDeliveryNotConfiguredError extends Error {
  constructor(channel: "email" | "sms") {
    super(`${channel.toUpperCase()} verification delivery is not configured.`);
    this.name = "VerificationDeliveryNotConfiguredError";
  }
}

class DisabledEmailVerificationSender implements EmailVerificationSender {
  readonly provider = "disabled";

  async send(_message: EmailVerificationMessage): Promise<void> {
    throw new VerificationDeliveryNotConfiguredError("email");
  }
}

class DisabledSmsVerificationSender implements SmsVerificationSender {
  readonly provider = "disabled";

  async send(_message: SmsVerificationMessage): Promise<void> {
    throw new VerificationDeliveryNotConfiguredError("sms");
  }
}

export const emailVerificationSender: EmailVerificationSender = createEmailVerificationSender();
export const smsVerificationSender: SmsVerificationSender = createSmsVerificationSender();

function createEmailVerificationSender(): EmailVerificationSender {
  const provider = process.env.AUTH_EMAIL_DELIVERY_PROVIDER || "disabled";
  if (provider === "disabled") {
    return new DisabledEmailVerificationSender();
  }
  throw new Error(`Unsupported AUTH_EMAIL_DELIVERY_PROVIDER: ${provider}`);
}

function createSmsVerificationSender(): SmsVerificationSender {
  const provider = process.env.AUTH_SMS_DELIVERY_PROVIDER || "disabled";
  if (provider === "disabled") {
    return new DisabledSmsVerificationSender();
  }
  throw new Error(`Unsupported AUTH_SMS_DELIVERY_PROVIDER: ${provider}`);
}
