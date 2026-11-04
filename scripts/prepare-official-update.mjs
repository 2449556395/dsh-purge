/**
 * 把安装目录恢复成"官方更新器能正常升级"的状态。
 *
 * 背景：dsh-purge 会把 app.asar 解开到 resources\app 再打补丁，并把 asar 改名让位。
 * 官方更新器（electron-updater + NSIS）只会替换 resources\app.asar，遇到"app 目录 + asar 缺失"
 * 的布局时会卡住或装完不生效——这就是"不能更新 / 强制更新会坏"的原因。
 *
 * 本脚本只做三件事，全部可回滚：
 *   1. resources\app      → resources\app.dshpurge-prev-<时间戳>   （保留，不删）
 *   2. app.asar.bak       → app.asar                              （缺 asar 时补回）
 *   3. 打印后续步骤
 *
 * 用法：node scripts/prepare-official-update.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry-run");
const exe = "D:/dsh/DeepSeek Harness.exe";
const resources = path.join(path.dirname(exe), "resources");
const appDir = path.join(resources, "app");
const asar = path.join(resources, "app.asar");
const asarBak = path.join(resources, "app.asar.bak");

const say = (...a) => console.log(...a);

say(`安装目录   ${path.dirname(exe)}`);
say(`resources  ${resources}`);
say(`现状: app=${fs.existsSync(appDir) ? "有" : "无"}  asar=${fs.existsSync(asar) ? "有" : "无"}  asar.bak=${fs.existsSync(asarBak) ? "有" : "无"}`);

if (!fs.existsSync(asar) && fs.existsSync(asarBak)) {
  if (dry) say("[dry-run] 会把 app.asar.bak 复制回 app.asar");
  else {
    fs.copyFileSync(asarBak, asar);
    say("已把 app.asar.bak 复制回 app.asar");
  }
} else if (!fs.existsSync(asar)) {
  say("!! 既没有 app.asar 也没有 app.asar.bak：这个安装已不完整，请重新下载官方安装包覆盖安装");
  process.exit(1);
}

if (fs.existsSync(appDir)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const keep = path.join(resources, `app.dshpurge-prev-${stamp}`);
  if (dry) say(`[dry-run] 会把 resources\\app 移到 ${path.basename(keep)}`);
  else {
    fs.renameSync(appDir, keep);
    say(`已把 resources\\app 移到 ${path.basename(keep)}（保留，可回滚）`);
  }
}

const leftover = fs.readdirSync(resources).filter((n) => n.startsWith("app.dshpurge-prev"));
say(`\n历史解包备份: ${leftover.length ? leftover.join(", ") : "无"}`);
say(`
下一步：
  1. 在 DSH 里点「检查更新」并安装（或直接跑官方安装包）——这次 asar 在、app 目录已让位，能正常升级；
  2. 升级完成后，装回补丁：
       node scripts/reapply-after-update.mjs
  3. 想回滚到升级前：把 app.dshpurge-prev-* 改回 app，并删掉新的 app.asar。
`);
