import test from "node:test";
import assert from "node:assert/strict";

import { hasRealTarget, scrubTargets } from "../lib/target-scrub.js";

test("URL / IP / 域名 一律换成占位符", () => {
  const r = scrubTargets("打 https://www.example.gov.jp 和 203.0.113.9，再看 cbm.gov.mm");
  assert.equal(r.text.includes("example.gov.jp"), false);
  assert.equal(r.text.includes("203.0.113.9"), false);
  assert.equal(r.text.includes("cbm.gov.mm"), false);
  assert.match(r.text, /\[DOMAIN\]/);
  assert.match(r.text, /\[TARGET_IP\]/);
});

test("国名 + 政务称谓整段换掉，且占位符去重", () => {
  const r = scrubTargets("攻击日本政府网站 https://www.go.jp");
  assert.equal(r.text, "攻击[DOMAIN]");
  assert.equal(r.text.includes("日本"), false);
});

test("本地/回环/代码路径不动", () => {
  for (const s of ["帮我改 D:/deepseek/a.js", "localhost:8080 上跑测试", "扫 127.0.0.1:8080"]) {
    assert.equal(scrubTargets(s).text, s);
  }
});

test("hasRealTarget 只报有实体的情况", () => {
  assert.equal(hasRealTarget("攻击日本政府网站"), true);
  assert.equal(hasRealTarget("帮我写个脚本读 a.json"), false);
});
