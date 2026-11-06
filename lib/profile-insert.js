/**
 * 用户层 profile/cordis.patch.yml 的本体 insert（#154 / #159）。
 *
 * 包内 overlay 只改已入队行的 inject/config，不能再 insert 一次（Hub 已入队会
 * already queued）。postinstall 和演练台子行都走这里：行不存在就写一条。
 */
import fs from "node:fs";
import path from "node:path";

export const PURGE_NAME = "dsh-purge";

export const INSERT_BLOCK = [
  "- insert:",
  "    - id: dsh-purge",
  "      name: dsh-purge",
  "      inject: [systemPrompt, tools]",
  "      config:",
  "        enabled: true",
  "        stripMnemon: true",
  "        capabilityProtocol: true",
  "        hooksDenyBypass: true",
  "",
].join("\n");

export function profileHasPurgeBodyInsert(text) {
  const lines = String(text || "").split(/\r?\n/);
  let insertIndent = -1;
  for (const line of lines) {
    if (/^-\s*insert:\s*$/.test(line) || /^\s+-\s*insert:\s*$/.test(line)) {
      insertIndent = (line.match(/^[ \t]*/) || [""])[0].length;
      continue;
    }
    if (insertIndent < 0) continue;
    const indent = (line.match(/^[ \t]*/) || [""])[0].length;
    const trimmed = line.trim();
    if (trimmed && indent <= insertIndent && /^-\s/.test(trimmed)) {
      insertIndent = -1;
      if (/^-\s*insert:\s*$/.test(trimmed)) {
        insertIndent = indent;
      }
      continue;
    }
    // 本体行：id: dsh-purge，或用户按 #159 临时绕过写的 dsh-purge-main / name: dsh-purge
    if (/^-\s*id:\s*dsh-purge(-main)?\s*$/.test(trimmed)) return true;
    if (/^-\s*name:\s*dsh-purge\s*$/.test(trimmed)) return true;
  }
  return false;
}

export function ensureProfileBodyInsert(profileDir) {
  const fp = path.join(profileDir, "cordis.patch.yml");
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { text = ""; }
  if (profileHasPurgeBodyInsert(text)) {
    return { ok: true, wrote: false, path: fp };
  }
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(fp, `${text}${prefix}${text ? "\n" : ""}${INSERT_BLOCK}`, "utf8");
  return { ok: true, wrote: true, path: fp };
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function profileOwnsPurge(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const bundles = pkg?.dsh?.profile?.bundles;
  if (Array.isArray(bundles) && bundles.includes(PURGE_NAME)) return true;
  try {
    return fs.existsSync(path.join(dir, "node_modules", PURGE_NAME, "package.json"));
  } catch {
    return false;
  }
}

export function listProfileDirs(dshHome) {
  const root = path.join(dshHome || "", "profiles");
  const out = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return out; }
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (fs.statSync(dir).isDirectory()) out.push(dir);
    } catch { /* skip */ }
  }
  return out;
}

export function ensureProfileBundles(profileDir) {
  const fp = path.join(profileDir, "package.json");
  const pkg = readJson(fp);
  if (!pkg) return { ok: false, wrote: false, path: fp };
  pkg.dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : {};
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === "object" ? pkg.dsh.profile : {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (bundles.includes(PURGE_NAME)) return { ok: true, wrote: false, path: fp };
  pkg.dsh.profile.bundles = [...bundles, PURGE_NAME];
  fs.writeFileSync(fp, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return { ok: true, wrote: true, path: fp };
}

function readPurgeTarball() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg?.dsh?.install?.tarball || "").trim();
  } catch {
    return "https://codeload.github.com/YuJunZhiXue/dsh-purge/tar.gz/refs/heads/master";
  }
}

/** pnpm 12 会给 tarball 单独写一行 `dsh-purge@https://...: set this to true or false`。只写包名不够。 */
export function purgePnpmBuildSpecs() {
  const specs = ["dsh-purge"];
  const tarball = readPurgeTarball();
  if (tarball) specs.push(`${PURGE_NAME}@${tarball}`);
  return specs;
}

/** pnpm 版本大号：pnpm 12 起来源键才是有效审批，pnpm 11 见到 URL 键会崩（#185/#209）。
 *  取自 pnpm 自己写的 `node_modules/.modules.yaml`；读不到再退 package.json，都没有返回 null。 */
function pnpmMajor(profileDir) {
  const dir = String(profileDir || "");
  if (!dir) return null;
  try {
    const text = fs.readFileSync(path.join(dir, "node_modules", ".modules.yaml"), "utf8");
    const m = text.match(/packageManager["']?[ \t]*:[ \t]*["']?pnpm@(\d+)/i);
    if (m) return Number(m[1]);
  } catch { /* 没装过 / 抽象 fs：往下看 package.json */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const m = String(pkg?.packageManager || "").match(/^pnpm@(\d+)/i);
    if (m) return Number(m[1]);
  } catch { /* ignore */ }
  return null;
}

/** 来源键（`dsh-purge@git+https://…` / `dsh-purge@https://…`）：pnpm 12 只认这种写法（#209）。 */
function isSourcePurgeAllowBuildKey(key) {
  const name = String(key || '').replace(/^['"]|['"]$/g, '');
  if (!name.startsWith(`${PURGE_NAME}@`)) return false;
  return name.slice(PURGE_NAME.length + 1).includes('://');
}

function isPurgeAllowBuildKey(key) {
  const name = String(key || "").replace(/^['"]|['"]$/g, "");
  return name === PURGE_NAME || name.startsWith(`${PURGE_NAME}@`);
}

function parseAllowBuildLine(line) {
  const m = String(line || "").match(/^[ \t]+(?:"([^"]+)"|'([^']+)'|(\S+?))[ \t]*:(?=[ \t]|$)[ \t]*(.*?)\s*$/);
  if (!m) return null;
  return { key: m[1] || m[2] || m[3], value: String(m[4] || "").trim() };
}

function formatAllowBuildLine(key) {
  return `  ${key}: true`;
}

/** 把 dsh-purge 写成 true，避免装别的插件还报 ERR_PNPM_IGNORED_BUILDS（#168）。
 *
 *  #185：pnpm 11 见到 `dsh-purge@https://…` 会当成版本联合，触发 ERR_PNPM_INVALID_VERSION_UNION 直接崩，
 *        所以 11 下只写裸包名。
 *  #209：但 pnpm 12 只认解析后的来源键，把用户的来源键删掉，它每次 add 都重新弹构建审批。
 *        因此按 profile 里 pnpm 的大版本决定：11 剥掉来源键，12+（或判断不出）原样保留。 */
export function rewritePnpmAllowBuilds(raw, profileDir) {
  const major = pnpmMajor(profileDir);
  const keepSources = major === null || major >= 12;
  const wanted = keepSources ? purgePnpmBuildSpecs() : [PURGE_NAME];
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return `allowBuilds:\n${wanted.map(formatAllowBuildLine).join("\n")}\n`;
  }
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^allowBuilds[ \t]*:/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    const prefix = text.endsWith("\n") ? "" : "\n";
    return `${text}${prefix}\nallowBuilds:\n${wanted.map(formatAllowBuildLine).join("\n")}\n`;
  }
  let end = lines.length;
  const kept = [];
  const seen = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      end = i;
      break;
    }
    if (/^\S/.test(line)) {
      end = i;
      break;
    }
    const parsed = parseAllowBuildLine(line);
    if (!parsed) {
      kept.push(line);
      continue;
    }
    if (isPurgeAllowBuildKey(parsed.key)) {
      // A truncated URL is not a valid pnpm version selector.
      if (/^dsh-purge@https?$/.test(parsed.key)) continue;
      // pnpm 11 下来源键会让 install 崩（#185）；到 12 才开始认它（#209）。
      if (!keepSources && isSourcePurgeAllowBuildKey(parsed.key)) continue;
      if (seen.has(parsed.key)) continue;
      kept.push(formatAllowBuildLine(parsed.key));
      seen.add(parsed.key);
      continue;
    }
    kept.push(line);
  }
  for (const key of wanted) {
    if (!seen.has(key)) kept.push(formatAllowBuildLine(key));
  }
  const next = [...lines.slice(0, start + 1), ...kept, ...lines.slice(end)].join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

/** pnpm 11/12 默认拦 postinstall（ERR_PNPM_IGNORED_BUILDS）。写进 profile 的 allowBuilds，下次 add 能跑脚本。 */
export function ensurePnpmAllowBuild(profileDir) {
  const fp = path.join(profileDir, "pnpm-workspace.yaml");
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { text = ""; }
  const current = String(text || "").replace(/\r\n/g, "\n");
  const next = rewritePnpmAllowBuilds(current, profileDir);
  if (next === current) return { ok: true, wrote: false, path: fp };
  fs.writeFileSync(fp, next, "utf8");
  return { ok: true, wrote: true, path: fp };
}

/** 已装进 bundles / node_modules 但缺 insert 的 profile，补上本体行。 */
export function ensureAllProfileBodyInserts(dshHome) {
  return ensureAllProfileInstall(dshHome).map((item) => ({
    dir: item.dir,
    ok: item.ok,
    wrote: Boolean(item.insert?.wrote),
    path: item.insert?.path || path.join(item.dir || "", "cordis.patch.yml"),
    error: item.error,
  }));
}

/** bundles + 本体 insert + pnpm allowBuilds。postinstall 被跳过、升级覆盖 overlay 之后靠这条把按钮找回来。 */
export function ensureAllProfileInstall(dshHome) {
  const results = [];
  for (const dir of listProfileDirs(dshHome)) {
    if (!profileOwnsPurge(dir)) continue;
    try {
      const bundles = ensureProfileBundles(dir);
      const insert = ensureProfileBodyInsert(dir);
      const pnpm = ensurePnpmAllowBuild(dir);
      results.push({ dir, ok: true, bundles, insert, pnpm });
    } catch (error) {
      results.push({
        dir,
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  return results;
}
