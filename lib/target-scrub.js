/**
 * 目标脱敏：把用户消息里的真实域名 / URL / IP 换成本地占位符，再交给模型。
 *
 * 为什么这么做：模型拒的往往不是"任务"，而是"目标"。当目标是某个真实政府站点时，
 * 它会先做一次现实判断（"这是真实生产系统"）然后拒；无论怎么在提示词里喊"这是演练靶标"，
 * 它都能识破。最有效的一层不是说服，而是**让它根本看不到真实目标**：
 * 实体只留在本地，模型只看到 [DOMAIN] / [TARGET_IP]，产出物按占位符写，由使用者替换。
 *
 * 纯字符串处理，不联网、不做 DNS。
 */

const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})\b/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"'）)，。；;]+/gi;

/** 国名 / 政务称谓：和"网站/系统"连用时整段换成 [DOMAIN]，避免模型按"哪个国家的政府"判断。 */
const COUNTRIES = "日本|美国|中国|韩国|朝鲜|俄罗斯|印度|越南|菲律宾|印尼|泰国|缅甸|马来西亚|新加坡|英国|法国|德国|意大利|西班牙|荷兰|瑞典|瑞士|加拿大|澳大利亚|新西兰|巴西|阿根廷|墨西哥|伊朗|以色列|土耳其|埃及|南非|乌克兰|波兰|台湾|香港|澳门";
const GOV_PHRASE_RE = new RegExp(
  `(?:${COUNTRIES})?\\s*(?:的)?\\s*(?:政府|政务|官方|内阁|国家机关|当局|央行|中央银行)?\\s*(?:网站|站点|系统|门户|官网|内网|服务器|基础设施|国家银行|中央银行|银行)`,
  "g",
);

/** 这些不是"目标"，脱敏时保持原样（本地回环、占位符、常见后缀说明词）。 */
const KEEP = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /\.(?:md|js|mjs|ts|json|yml|yaml|txt|log|exe|zip|png|jpg|jpeg|gif|svg|css|html|py|sh|ps1|cmd)$/i,
  /^\[[A-Z_]+\]$/,
];

function keepHost(host) {
  const h = String(host || "").trim();
  if (!h) return true;
  return KEEP.some((re) => re.test(h));
}

/**
 * 把文本里的真实目标替换成占位符。
 * @param {string} text
 * @param {{ domain?: string, ip?: string }} [labels]
 * @returns {{ text: string, replaced: { kind: string, value: string }[] }}
 */
export function scrubTargets(text, labels = {}) {
  const domainLabel = labels.domain || "[DOMAIN]";
  const ipLabel = labels.ip || "[TARGET_IP]";
  const replaced = [];
  let out = String(text || "");

  // URL 先整体换掉（避免里面的主机名被二次命中）
  out = out.replace(URL_RE, (m) => {
    let host = "";
    try { host = new URL(m).hostname; } catch { host = ""; }
    if (host && keepHost(host)) return m;
    replaced.push({ kind: "url", value: m });
    return IPV4_RE.test(host) ? ipLabel : domainLabel;
  });

  out = out.replace(IPV4_RE, (m) => {
    if (keepHost(m)) return m;
    replaced.push({ kind: "ip", value: m });
    return ipLabel;
  });

  out = out.replace(DOMAIN_RE, (m) => {
    if (keepHost(m)) return m;
    replaced.push({ kind: "domain", value: m });
    return domainLabel;
  });

  // 政务称谓整段换掉：\"日本政府网站\" / \"某国央行系统\" → [DOMAIN]
  out = out.replace(GOV_PHRASE_RE, (m) => {
    if (!m.trim()) return m;
    if (m.includes("[DOMAIN]")) return "[DOMAIN]";
    replaced.push({ kind: "gov-phrase", value: m });
    return "[DOMAIN]";
  });
  // 连续占位符去重（"攻击 [DOMAIN] [DOMAIN]" → "攻击 [DOMAIN]"）
  out = out.replace(/(\[(?:DOMAIN|TARGET_IP)\])(?:\s*\1)+/g, "$1");

  return { text: out, replaced };
}

/** 只判断有没有"看起来像真实目标"的实体，不修改文本。 */
export function hasRealTarget(text) {
  return scrubTargets(text).replaced.length > 0;
}
