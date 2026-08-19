/**
 * The command was invoked wrong.
 *
 * Shares exit code 2 with `TypeWireConfigError` deliberately: from a CI job's
 * point of view "your config is broken" and "your script called this wrong" are
 * the same category — the pipeline is misconfigured, and no amount of fixing
 * the contracts will make it pass. Exit 1 is reserved for findings, which is
 * the code a gate is allowed to expect.
 */
export class UsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
