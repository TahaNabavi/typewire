import type { ApiTestReport } from "./types";

export function createMarkdownReport(report: ApiTestReport): string {
  const lines: string[] = [];

  lines.push("# TypeFetch API Test Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Total | Passed | Failed | Skipped | Duration |");
  lines.push("|---:|---:|---:|---:|---:|");
  lines.push(
    `| ${report.summary.total} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.skipped} | ${formatMs(report.summary.durationMs)} |`,
  );
  lines.push("");

  const failed = report.results.filter((item) => item.status === "failed");
  if (failed.length) {
    lines.push("## Failed Endpoints");
    lines.push("");
    for (const item of failed) {
      lines.push(`### ${item.module}.${item.endpoint} — ${item.caseName}`);
      lines.push("");
      lines.push(`- Phase: ${item.phase}`);
      lines.push(`- Method: ${item.method}`);
      lines.push(`- Path: ${item.path}`);
      lines.push(`- Duration: ${formatMs(item.durationMs)}`);
      if (item.error?.status) lines.push(`- HTTP Status: ${item.error.status}`);
      if (item.error?.code) lines.push(`- Code: ${item.error.code}`);
      lines.push(`- Error: ${escapeMarkdown(item.error?.message ?? "Unknown error")}`);
      if (item.error?.issues) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(item.error.issues, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }

  lines.push("## All Results");
  lines.push("");
  lines.push("| Status | Endpoint | Case | Phase | Method | Path | Duration |");
  lines.push("|---|---|---|---|---|---|---:|");

  for (const item of report.results) {
    lines.push(
      `| ${item.status} | ${item.module}.${item.endpoint} | ${escapeTable(item.caseName)} | ${item.phase} | ${item.method} | ${escapeTable(item.path)} | ${formatMs(item.durationMs)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function createHtmlReport(report: ApiTestReport): string {
  const rows = report.results
    .map(
      (item) => `
        <tr class="${item.status}">
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(`${item.module}.${item.endpoint}`)}</td>
          <td>${escapeHtml(item.caseName)}</td>
          <td>${escapeHtml(item.phase)}</td>
          <td>${escapeHtml(item.method)}</td>
          <td>${escapeHtml(item.path)}</td>
          <td>${formatMs(item.durationMs)}</td>
          <td>${escapeHtml(item.error?.message ?? "")}</td>
        </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TypeFetch API Test Report</title>
  <style>
    body { font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; background: #0f1115; color: #f4f4f5; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0; }
    .card { background: #181b22; border: 1px solid #2a2f3a; border-radius: 14px; padding: 16px 18px; min-width: 120px; }
    .card strong { display: block; font-size: 24px; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; background: #181b22; border-radius: 14px; overflow: hidden; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #2a2f3a; text-align: left; vertical-align: top; }
    th { color: #a1a1aa; font-size: 13px; }
    tr.passed td:first-child { color: #34d399; }
    tr.failed td:first-child { color: #fb7185; }
    tr.skipped td:first-child { color: #fbbf24; }
    code { background: #272b35; padding: 2px 5px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>TypeFetch API Test Report</h1>
  <p>Generated at: <code>${escapeHtml(report.generatedAt)}</code> · Mode: <code>${escapeHtml(report.mode)}</code></p>
  <section class="cards">
    <div class="card">Total<strong>${report.summary.total}</strong></div>
    <div class="card">Passed<strong>${report.summary.passed}</strong></div>
    <div class="card">Failed<strong>${report.summary.failed}</strong></div>
    <div class="card">Skipped<strong>${report.summary.skipped}</strong></div>
    <div class="card">Duration<strong>${formatMs(report.summary.durationMs)}</strong></div>
  </section>
  <table>
    <thead>
      <tr><th>Status</th><th>Endpoint</th><th>Case</th><th>Phase</th><th>Method</th><th>Path</th><th>Duration</th><th>Error</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeMarkdown(value: string): string {
  return value.replace(/`/g, "\\`");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
