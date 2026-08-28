export class CommerceDataToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly instruction: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CommerceDataToolError";
  }
}
