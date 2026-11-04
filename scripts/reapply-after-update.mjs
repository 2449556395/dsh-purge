/**
 * 官方更新之后，把宿主重新解包并打回补丁（等价于面板上的「应用」）。
 *
 * 用法：
 *   node scripts/reapply-after-update.mjs            # 解包 + 写补丁 + 让 asar 让位
 *   node scripts/reapply-after-update.mjs --dry-run  # 只检查当前布局
 *
 * 说明：走的是插件自己的 core.openSealedDesktopHost / applyPatchesAllHosts，
 * 与面板「应用」同一套逻辑，不会另写一份判定。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dry = process.argv.includes("--dry-run");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

process.env.DSH_SURFACE = process.env.DSH_SURFACE || "desktop";
process.env.DSH_PROFILE = process.env.DSH_PROFILE || "desktop";

const core = await load("lib/core.js");

const exe = "D:/dsh/DeepSeek Harness.exe";
const resources = path.join(path.dirname(exe), "resources");
const asar = path.join(resources, "app.asar");
const appDir = path.join(resources, "app");

console.log(`resources  ${resources}`);
console.log(`asar=${fs.existsSync(asar) ? "有" : "无"}  app=${fs.existsSync(appDir) ? "有" : "无"}`);

if (dry) {
  console.log("dry-run：不做任何修改。");
  process.exit(0);
}

core.applyRuntimeEnv?.();
core.clearDesktopLocateCache?.();

console.log("[1/3] 解包 / 定位");
const located = await core.resolveOfficialAiBase(null, { forApply: true });
console.log("      aiBase =", located.aiBase, "extracted =", !!located.extracted);
if (!located.aiBase) {
  console.error("定位失败：asar 里没有 @deepseek-ai，请确认安装完整");
  process.exit(2);
}
if (located.extracted && located.handoff?.archive) core.writeUnpackedAsarStamp(located.handoff.archive);

console.log("[2/3] 写补丁");
const multi = await core.applyPatchesAllHosts(core.ALL_PATCHES, { preserveClientBundles: false, forApply: true });
const summary = core.summarizeApplyReport(multi.report);
console.log(`      applied=${summary.applied} already=${summary.already} failed=${summary.failed.length}`);
for (const f of summary.failed) console.log("      FAIL", f.patch_id, f.name, f.status);

console.log("[3/3] 收尾");
try { console.log("      shims:", JSON.stringify(await core.patchAllShims())); } catch (e) { console.log("      shims 跳过:", String(e?.message || e)); }
try { console.log("      cliRepair:", JSON.stringify(core.repairOfficialCliAfterUnpack())); } catch (e) { console.log("      cliRepair 跳过:", String(e?.message || e)); }
try { console.log("      flash:", JSON.stringify(core.silenceCmdFlash(multi.hosts[0]?.aiBase))); } catch (e) { console.log("      flash 跳过:", String(e?.message || e)); }

const st = await core.patchStatus(located.aiBase);
const counts = {};
for (const v of Object.values(st)) counts[v] = (counts[v] || 0) + 1;
console.log("      patchStatus:", JSON.stringify(counts));

const handoff = located.handoff?.swapAsar ? located.handoff : null;
if (handoff) {
  console.log("      asar 让位:", JSON.stringify(core.scheduleSealedDesktopRestart(handoff)));
  console.log("      stillSealed:", core.desktopAsarStillSealed());
}
console.log("\n完成。重启 DSH 让补丁生效；回滚用 app.dshpurge-prev-* 目录。");
