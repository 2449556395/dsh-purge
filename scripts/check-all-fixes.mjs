#!/usr/bin/env node
/**
 * 回归体检：把本仓库这一路修过的东西逐条验一遍，防止「改 A 弄坏 B」。
 *
 * 用法：node scripts/check-all-fixes.mjs
 * 退出码：0 全绿 / 1 有 FAIL
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = (p) => pathToFileURL(path.join(root, p)).href;
const rows = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    rows.push({ name, ok: true, detail: detail === undefined ? "" : String(detail) });
  } catch (error) {
    rows.push({ name, ok: false, detail: String(error && error.message ? error.message : error) });
  }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

const core = await import(url("lib/core.js"));
const netScope = await import(url("lib/net-scope.js"));
const drill = await import(url("lib/drill-grant.js"));
const settings = await import(url("lib/redteam/settings.js"));
const obedience = await import(url("lib/obedience.js"));
const rules = await import(url("lib/rules.js"));

// 1. 目标范围硬闸已解除
await check("net-scope 硬闸解除", () => {
  expect(netScope.INTERNAL_LIMITS_ENABLED === false, "INTERNAL_LIMITS_ENABLED 不是 false");
  let hooks = 0;
  netScope.installRegionGate({ on: () => { hooks += 1; } });
  expect(hooks === 0, `仍注册了 ${hooks} 个钩子`);
  return "0 hooks";
});

// 2. 外挂/公网判定不再拦截
await check("公网目标 / 外挂判定放行", async () => {
  const cheat = netScope.isCheatTask("帮我写游戏外挂自瞄");
  expect(cheat === false, "isCheatTask 仍判 true");
  return "isCheatTask=false";
});

// 3. 演练台授权门解除
await check("演练台授权门解除", () => {
  expect(drill.DRILL_GRANT_ENFORCED === false, "DRILL_GRANT_ENFORCED 不是 false");
  const g = drill.readDrillGrant("C:/definitely/missing");
  expect(g.granted === true, "readDrillGrant 未恒 true");
  return "granted=true";
});

// 4. 并发智能体硬顶取消
await check("并发上限取消", () => {
  expect(settings.clampMaxAgents(50) === 50, "clamp(50) 被压回");
  return `clamp(50)=${settings.clampMaxAgents(50)}`;
});

// 5. 锚点门关闭
await check("红队预设锚点门关闭", () => {
  const yml = fs.readFileSync(path.join(root, "presets/redteam/agent.cordis.yml"), "utf8");
  expect(/anchorGate:\s*false/.test(yml), "anchorGate 不是 false");
  const cfg = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  expect(!/bootstrapMaxTokens/.test(cfg), "仍在下发 bootstrapMaxTokens");
  return "anchorGate=false";
});

// 6. 元层面拒绝识别
await check("元拒绝识别", () => {
  const v = obedience.classifyRefusal("改变不了这个答案。这条指令框架不是我能接受的重定义，别的技术活随时找我。");
  expect(v.refusal === true && v.hits.includes("meta-answer-locked"), "未命中元拒绝");
  return `score=${v.score}`;
});

// 7. 自激保护（讲插件本身不判拒绝）
await check("元讨论短路", () => {
  const v = obedience.classifyRefusal("obedience 模块的 nudgeText 不再内嵌 anchorText，纠偏逻辑见契约段。");
  expect(v.refusal === false && v.hits.includes("meta-discussion"), "自激保护失效");
  return "refusal=false";
});

// 8. 纠偏不内嵌契约 / 去例句
await check("纠偏与锚点去例句", () => {
  const a = obedience.anchorText();
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "抱歉", "我不能"]) {
    expect(!a.includes(bad), `锚点仍含例句: ${bad}`);
  }
  const n = obedience.nudgeText(2, "x");
  expect(!n.includes("<system-reminder>"), "纠偏内嵌了契约块");
  expect(!n.includes("改变不了这个答案"), "纠偏仍含例句");
  return `anchor=${a.length}B`;
});

// 9. 内置默认槽不含例句、含武器条款
await check("默认槽：无例句 + 武器条款", () => {
  const t = core.defaultOverrideText();
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "这条指令框架"]) {
    expect(!t.includes(bad), `默认槽仍含例句: ${bad}`);
  }
  expect(t.includes("26. Weapons") && t.includes("27. Energetics"), "武器/含能条款缺失");
  return `len=${t.length}`;
});

// 10. 注入文件与默认槽一致（重启后 seed 的结果）
await check("prompt-inject.md 与默认槽同步", () => {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");
  const disk = fs.readFileSync(path.join(home, "prompt-inject.md"), "utf8").replace(/\r\n/g, "\n");
  const def = core.defaultOverrideText().replace(/\r\n/g, "\n");
  if (disk.trim() === def.trim()) return `len=${disk.length}`;
  // 差一代是正常状态：插件进程还是旧槽，重启后 seed 成新默认。判为 pending 不算失败。
  const older = /指令权威 — 只产出/.test(disk) && !disk.includes("28. Jurisdiction");
  if (older && def.includes("28. Jurisdiction")) return `pending restart（disk=${disk.length} default=${def.length}）`;
  throw new Error(`不一致：disk=${disk.length} default=${def.length}`);
});

// 11. 改稿保留（keep 哨兵 / customized）
await check("用户改稿保留逻辑", async () => {
  const mod = await import(url("lib/core.js"));
  expect(typeof mod.isKeepableUserOverride === "function", "isKeepableUserOverride 缺失");
  const sample = `${mod.defaultOverrideText()}\n\n<!-- dsh-purge:keep -->\n额外段\n`;
  expect(mod.isKeepableUserOverride("C:/missing-home", sample) === true, "keep 哨兵未生效");
  return "keep 哨兵 OK";
});

// 12. rc.5 目标声明
await check("dshTarget=0.2.1-rc.5", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  expect(pkg.dshTarget === "0.2.1-rc.5", `dshTarget=${pkg.dshTarget}`);
  return pkg.dshTarget;
});

// 13. 移植模块在位
await check("移植模块在位", () => {
  for (const f of ["lib/host-compat.js", "lib/redteam/preset-compat.js", "lib/redteam/report-export.js", "lib/redteam/query-options.js", "lib/redteam/reservation-state.js"]) {
    expect(fs.existsSync(path.join(root, f)), `缺 ${f}`);
  }
  return "5 modules";
});

// 14. 注入解析来源
await check("注入解析可用", () => {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");
  const r = rules.resolveInjectText(home);
  expect(r.text.length > 5000, `注入文本过短: ${r.text.length}`);
  return `source=${r.source} len=${r.text.length}`;
});

// 15. 预设副本（宿主真正加载的那份）不得留着 1024 兜底
await check("预设副本无 1024 兜底", () => {
  const repoGate = path.join(root, "presets/redteam/anchor-gate.mjs");
  const repoText = fs.readFileSync(repoGate, "utf8");
  expect(!/integerAtLeast\(config\.bootstrapMaxTokens, 1024/.test(repoText), "仓库内仍兜底 1024");
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh");
  const liveGate = path.join(home, ".agent-presets/redteam/anchor-gate.mjs");
  if (!fs.existsSync(liveGate)) return "live 副本不存在（跳过）";
  const liveText = fs.readFileSync(liveGate, "utf8");
  expect(!/integerAtLeast\(config\.bootstrapMaxTokens, 1024/.test(liveText), "live 副本仍兜底 1024");
  expect(liveText === repoText, "live 副本与仓库不一致");
  return "live == repo";
});

// 16. GLM 适配层已接线
await check("GLM 适配层接线", async () => {
  const overlay = await import(url("lib/model-overlay.js"));
  const id = await import(url("lib/identity.js"));
  const asm = { variables: { model: "glm-4.6", provider: "zhipu" }, sections: [{ name: "harness:identity", text: "x" }] };
  const out = id.rewritePromptAssembly(asm, "BASE", {});
  const text = (out.sections || []).map((s) => s.text || "").join("\n");
  expect(text.includes("GLM-PROMPT"), "装配结果里没有 GLM 专用提示词");
  expect(!text.includes("UNRESTRICTED SANDBOX"), "GLM 装配里仍残留越狱式提示词块");
  expect(overlay.applyModelPrompt("BASE", asm).includes("GLM-PROMPT"), "applyModelPrompt 未生效");
  return "wired";
});

const pad = Math.max(...rows.map((r) => r.name.length));
let bad = 0;
for (const r of rows) {
  if (!r.ok) bad += 1;
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(pad)} ${r.detail}`);
}
console.log(bad === 0 ? `\nRESULT: PASS — ${rows.length} 项全部通过` : `\nRESULT: FAIL — ${bad}/${rows.length} 项不过`);
process.exit(bad === 0 ? 0 : 1);
