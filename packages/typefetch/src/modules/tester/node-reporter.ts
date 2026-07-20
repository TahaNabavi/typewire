import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { ApiTestReport } from "./types";
import { createHtmlReport, createMarkdownReport } from "./reporter";

export async function writeReportFiles(
  report: ApiTestReport,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  const ext = extname(outputPath).toLowerCase();
  if (ext === ".json") {
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    return;
  }

  if (ext === ".html") {
    await writeFile(outputPath, createHtmlReport(report), "utf8");
    return;
  }

  await writeFile(outputPath, createMarkdownReport(report), "utf8");
}
