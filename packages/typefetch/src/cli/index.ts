import { runCli } from "./run-cli";

runCli(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`TypeFetch CLI error:\n${message}`);
  process.exit(1);
});
