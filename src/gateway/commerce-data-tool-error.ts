export class CommerceDataToolError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly instruction: string,
  ) {
    super(message);
    this.name = "CommerceDataToolError";
  }
}
