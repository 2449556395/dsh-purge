#!/usr/bin/env node
/**
 * Export a movable report bundle into a NEW child directory of --out (default cwd).
 * Existing reports and shots/ are never overwritten or removed. manifest.json marks
 * completion and records SHA-256 hashes of the report and its referenced evidence.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportEngagementReport, parseReportExportArgs } from '../lib/redteam/report-export.js';

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), log = console.log, createStore } = {}) {
  const options = parseReportExportArgs(argv, env, cwd);
  if (options.help) {
    log('用法：node scripts/export-engagement-report.mjs [--root <数据目录>] [--engagement <id>] [--out <输出父目录>] [--shareable]\n'
      + '默认根目录：REDTEAM_HOME 或 DSH_HOME/redteam 或 ~/.dsh/redteam。\n'
      + '默认导出当前靶标；每次在 --out（默认当前目录）下新建独立交付包，不覆盖已有文件。\n'
      + '普通模式包含 Markdown、引用的 shots/ 文件和 SHA-256 manifest.json。\n'
      + '--shareable 是可选的初步脱敏副本：隐藏常见凭据/IP，省略截图，仍须人工检查后分享。');
    return null;
  }
  const result = await exportEngagementReport(options, { createStore });
  log('✓ 报告：' + result.reportFile);
  log('  清单：' + result.manifestFile);
  log(`  合计 ${result.manifest.summary.points} 分 · ${result.manifest.summary.items} 条正文 · ${result.manifest.summary.evidenceFiles} 个证据文件`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('导出失败：' + error.message);
    process.exitCode = 1;
  });
}
