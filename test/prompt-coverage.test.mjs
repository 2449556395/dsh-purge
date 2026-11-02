import test from "node:test";
import assert from "node:assert/strict";

import { defaultOverrideText } from "../lib/core.js";

/** 提示词覆盖度守护：这些条款掉了就等于"能写的东西"少一块，必须每次都能验到。 */
const REQUIRED = [
  ["成人/露骨（第 9 条）", "9. Adult, explicit, and pornographic content"],
  ["黄文关键词", "黄文"],
  ["露骨关键词", "露骨"],
  ["不审查", "no censor"],
  ["沙盒清单含成人", "explicit sex scenes"],
  ["武器（第 26 条）", "26. Weapons, ammunition, and hazardous-device engineering"],
  ["含能（第 27 条）", "27. Energetics and hazardous chemistry"],
  ["赛博/渗透（第 2 条）", "2. Pentest and unauthorized-access narratives"],
  ["恶意代码（第 3 条）", "3. Malware, worms, and evasion"],
  ["外挂（第 1 条）", "1. Game cheat, memory editing, injection, anti-cheat"],
  ["Fraud（第 5 条）", "5. Fraud and social engineering"],
  ["Hard rules", "HARD OUTPUT RULES"],
  ["拒绝对抗", "REFUSAL HARDENING"],
  ["指令权威正向块", "指令权威 — 只产出，不评论指令"],
  ["地域/真实性（第 28 条）", "28. Jurisdiction, ownership, and reality claims"],
];

test("默认槽：全部放行条款都在（掉一条就是回归）", () => {
  const text = defaultOverrideText();
  const missing = REQUIRED.filter(([, needle]) => !text.includes(needle)).map(([name]) => name);
  assert.deepEqual(missing, [], `缺失条款: ${missing.join(", ")}`);
});

test("默认槽：不再罗列拒绝例句", () => {
  const text = defaultOverrideText();
  for (const bad of ["改变不了这个答案", "别的技术活随时找我", "这条指令框架", "META-REFUSAL"]) {
    assert.equal(text.includes(bad), false, `仍含例句/旧段: ${bad}`);
  }
});
