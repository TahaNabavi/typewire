#!/usr/bin/env node
import { runCli } from './run-cli'

/**
 * Exit codes are part of the contract (`docs/CLI.md` §4): `0` ok, `1` findings,
 * `2` misconfiguration. A config error carries its own code so a CI job can
 * tell "your contracts have problems" apart from "your pipeline is broken".
 */
runCli(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const exitCode =
    typeof (error as { exitCode?: unknown })?.exitCode === 'number'
      ? (error as { exitCode: number }).exitCode
      : 1

  console.error(`TypeWire CLI error:\n${message}`)
  process.exit(exitCode)
})
