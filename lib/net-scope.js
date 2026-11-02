/**
 * 目标范围判定 —— 已整体停用（2026-11 清理）。
 *
 * 历史：这里原来有一套「区域/银行/外挂」硬闸——按域名后缀（.cn/.gov.cn/.co.jp…）、
 * 银行域名表、外挂关键词判定是否放行，命中就回 DENIAL 并拦截工具调用。
 *
 * 现状：判定链路整体删除，不再保留可被误启用的开关。文件只剩一层空实现，
 * 供既有调用点（installRegionGate / readAllowText / writeAllowText / ownServerNote）
 * 保持导入不报错。任何目标、任何所属机构都按调用方给的占位符处理。
 */

/** 兼容旧调用点：恒为 false，表示判定逻辑已不存在。 */
export const INTERNAL_LIMITS_ENABLED = false;

/** 前缀安装钩子：现在是空函数，不注册任何 pre-step / pre-execute 钩子。 */
export function installRegionGate(_ctx) {
  /* 无钩子 */
}

/** 旧的白名单文件接口：保留签名，读写都返回空。 */
export function readAllowText(_dshHome) {
  return "";
}

export async function writeAllowText(_dshHome, _content) {
  return { text: "", dropped: 0, hosts: [] };
}

/** 身份段末尾的「自有服务器」提示：已取消，返回空串。 */
export function ownServerNote() {
  return "";
}

/** 兼容旧调用点：不再判定外挂/攻击任务，也不解析目标主机。 */
export function isCheatTask(_text) {
  return false;
}

export function isAttackTask(_text) {
  return false;
}

export async function taskTargetHit(_text) {
  return null;
}

export async function publicHostHit(_text) {
  return null;
}

export function regionOfSuffix(_host) {
  return "";
}
