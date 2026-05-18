/** Domain error whose message is safe to surface to the agent. */
export class KairoError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'KairoError';
  }
}
