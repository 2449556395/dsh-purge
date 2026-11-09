import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { makeShareableReport } from './report-shareable.js';

const FLAGS = new Set(['root', 'engagement', 'out']);
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function absolute(value, cwd) {
  const expanded = /^~(?:[/\\]|$)/.test(value) ? path.join(homedir(), value.slice(1)) : value;
  return path.resolve(cwd, expanded);
}

/** Parse CLI options without opening a store or writing files. */
export function parseReportExportArgs(argv, env = process.env, cwd = process.cwd()) {
  const values = {};
  let help = false;
  let shareable = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--shareable') {
      if (shareable) throw new Error('重复参数：--shareable');
      shareable = true; continue;
    }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match || !FLAGS.has(match[1])) throw new Error(`未知参数：${arg}`);
    const name = match[1];
    if (Object.hasOwn(values, name)) throw new Error(`重复参数：--${name}`);
    const value = match[2] === undefined ? argv[++i] : match[2];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--') || (match[2] === undefined && value.startsWith('-'))) {
      throw new Error(`--${name} 缺少有效值`);
    }
    values[name] = value;
  }
  const root = values.root || env.REDTEAM_HOME || path.join(env.DSH_HOME || path.join(homedir(), '.dsh'), 'redteam');
  return { root: absolute(root, cwd), engagement: values.engagement, outDir: absolute(values.out || cwd, cwd), help,
    ...(shareable ? { shareable: true } : {}) };
}

function segment(value, description) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..'
    || /[\x00-\x1f\x7f/\\:*?"<>|]/.test(value) || /[. ]$/.test(value) || RESERVED.test(value)) {
    throw new Error(`${description} 不是有效的独立路径段`);
  }
  return value;
}

/** Reject symlinks/junctions at every existing directory component, not only the leaf. */
function directoryTree(directory, create = false) {
  const target = path.resolve(directory);
  const base = path.parse(target).root;
  let current = base;
  const components = target.slice(base.length).split(path.sep).filter(Boolean);
  for (const part of [null, ...components]) {
    if (part !== null) current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      try { fs.mkdirSync(current, { mode: 0o700 }); } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`目录不是普通目录或经过符号链接：${current}`);
  }
  return target;
}

function engagementDirectory(root, engagement) {
  return directoryTree(path.join(root, 'engagements', segment(engagement, 'engagement')));
}

function evidenceFiles(engagementDir, report) {
  if (!report || typeof report.markdown !== 'string' || !Array.isArray(report.items)) {
    throw new Error('报告缺少 markdown 或 items');
  }
  const files = new Map();
  const portable = new Map();
  for (const item of report.items) {
    if (item.shots != null && !Array.isArray(item.shots)) throw new Error('报告 shots 必须是数组');
    for (const shot of item.shots || []) {
      const ref = shot?.url;
      if (typeof ref !== 'string' || !ref.startsWith('shots/') || /[%#]/.test(ref)) {
        throw new Error('截图引用必须是未编码的 shots/ 相对路径');
      }
      const parts = ref.split('/');
      for (const part of parts) segment(part, '截图引用');
      if (parts.length < 2) throw new Error('截图引用缺少文件名');
      const key = ref.normalize('NFC').toLowerCase();
      if (portable.has(key) && portable.get(key) !== ref) throw new Error(`截图路径大小写或 Unicode 冲突：${ref}`);
      portable.set(key, ref);
      if (files.has(ref)) continue;
      const source = path.join(engagementDir, ...parts);
      directoryTree(path.dirname(source));
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`截图不是普通文件：${ref}`);
      files.set(ref, { ref, source, stat });
    }
  }
  return [...files.values()];
}

function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function safeStem(value) {
  let name = Array.from(String(value).replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_')).slice(0, 64).join('').replace(/[. ]+$/, '');
  if (!name || name === '.' || name === '..') name = 'report';
  if (RESERVED.test(name)) name = '_' + name;
  return name;
}

/**
 * Package an already-rendered report. Every call creates a new child of outDir.
 * manifest.json is written last and marks a complete bundle. It hashes the report
 * and exactly the evidence referenced by report.items[].shots[].url, not itself.
 */
export function writeReportBundle({ root, engagement, outDir = process.cwd(), report, shareable = false }) {
  const sourceDir = engagementDirectory(path.resolve(root), engagement);
  const finalReport = shareable ? makeShareableReport(report) : report;
  const evidence = evidenceFiles(sourceDir, finalReport); // Validate before output creation.
  const outputParent = directoryTree(outDir, true);
  const createdAt = new Date().toISOString();
  const stem = safeStem(finalReport.target || engagement);
  const bundleDir = path.join(outputParent, `${stem}-report-${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`);
  const ownedFiles = [];
  const ownedDirs = [];
  const entries = [];
  const withinBundle = (target) => {
    const relative = path.relative(bundleDir, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('输出路径超出本次交付包');
  };
  function createDirectory(target) {
    withinBundle(target);
    directoryTree(path.dirname(target));
    fs.mkdirSync(target, { mode: 0o700 });
    ownedDirs.push({ path: target, stat: fs.lstatSync(target) });
  }
  function ensureParent(target) {
    const parent = path.dirname(target);
    const parts = path.relative(bundleDir, parent).split(path.sep).filter(Boolean);
    let current = bundleDir;
    for (const part of parts) {
      current = path.join(current, part);
      if (!ownedDirs.some((entry) => entry.path === current)) createDirectory(current);
      else directoryTree(current);
    }
  }
  function createFile(target) {
    withinBundle(target);
    directoryTree(path.dirname(target));
    const fd = fs.openSync(target, 'wx', 0o600);
    try { ownedFiles.push({ path: target, stat: fs.fstatSync(fd) }); }
    catch (error) { fs.closeSync(fd); throw error; }
    return fd;
  }
  function writeBuffer(relative, bytes, record = true) {
    const fd = createFile(path.join(bundleDir, relative));
    try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
    if (record) entries.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  function copyEvidence(file) {
    directoryTree(path.dirname(file.source));
    const src = fs.openSync(file.source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const before = fs.fstatSync(src);
      if (!before.isFile() || !sameFile(before, file.stat) || before.size !== file.stat.size || before.mtimeMs !== file.stat.mtimeMs || before.ctimeMs !== file.stat.ctimeMs) {
        throw new Error(`截图在校验后发生变化：${file.ref}`);
      }
      const target = path.join(bundleDir, ...file.ref.split('/'));
      ensureParent(target);
      const dst = createFile(target);
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        const buffer = Buffer.alloc(64 * 1024);
        while (bytes < before.size) {
          const count = fs.readSync(src, buffer, 0, Math.min(buffer.length, before.size - bytes), null);
          if (count === 0) throw new Error(`截图在复制时被截断：${file.ref}`);
          let written = 0;
          while (written < count) {
            const amount = fs.writeSync(dst, buffer, written, count - written);
            if (amount <= 0) throw new Error(`截图写入未取得进展：${file.ref}`);
            written += amount;
          }
          hash.update(buffer.subarray(0, count));
          bytes += count;
        }
      } finally { fs.closeSync(dst); }
      const after = fs.fstatSync(src);
      if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(`截图在复制时发生变化：${file.ref}`);
      }
      entries.push({ path: file.ref, bytes, sha256: hash.digest('hex') });
    } finally { fs.closeSync(src); }
  }
  function cleanup() {
    const failures = [];
    for (const entry of [...ownedFiles].reverse()) {
      try {
        withinBundle(entry.path);
        directoryTree(path.dirname(entry.path));
        const actual = fs.lstatSync(entry.path);
        if (actual.isSymbolicLink() || !actual.isFile() || !sameFile(actual, entry.stat)) throw new Error(`拒绝清理已被替换的文件：${entry.path}`);
        fs.unlinkSync(entry.path);
      } catch (error) { if (error.code !== 'ENOENT') failures.push(error); }
    }
    for (const entry of [...ownedDirs].reverse()) {
      try {
        withinBundle(entry.path);
        directoryTree(entry.path);
        if (!sameFile(fs.lstatSync(entry.path), entry.stat)) throw new Error(`拒绝清理已被替换的目录：${entry.path}`);
        fs.rmdirSync(entry.path); // Never recurse: unexpected files remain untouched.
      } catch (error) { if (error.code !== 'ENOENT') failures.push(error); }
    }
    return failures;
  }
  try {
    createDirectory(bundleDir);
    const reportName = `${stem}-红队成果复现报告.md`;
    writeBuffer(reportName, Buffer.from(finalReport.markdown, 'utf8'));
    for (const file of evidence) copyEvidence(file);
    const manifest = {
      schemaVersion: 1, createdAt, engagementId: shareable ? '[REDACTED]' : engagement, report: reportName,
      summary: { points: finalReport.summary?.points ?? 0, items: finalReport.items.length, evidenceFiles: evidence.length },
      ...(shareable ? { privacy: { mode: 'shareable', evidenceOmitted: true, manualReviewRequired: true } } : {}),
      files: entries,
    };
    writeBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'), false);
    return { bundleDir, reportFile: path.join(bundleDir, reportName), manifestFile: path.join(bundleDir, 'manifest.json'), manifest };
  } catch (error) {
    const failures = cleanup();
    if (failures.length) throw new AggregateError([error, ...failures], `导出失败，部分文件保留于 ${bundleDir}：${error.message}`);
    throw error;
  }
}

/** Store creation is lazy; importing this module never opens or creates a store. */
export async function exportEngagementReport(options = {}, { createStore } = {}) {
  const parsed = parseReportExportArgs([], process.env);
  const root = directoryTree(options.root || parsed.root);
  if (options.engagement !== undefined) engagementDirectory(root, options.engagement);
  const factory = createStore || (async (directory) => {
    const { RedteamStore } = await import('./store-core.js');
    return new RedteamStore(directory);
  });
  const store = await factory(root);
  let originalError;
  try {
    const engagement = options.engagement ?? store.activeEngagementId();
    if (!engagement) throw new Error('没有可用靶标：先用面板创建，或用 --engagement <id> 指定');
    engagementDirectory(root, engagement);
    const report = await store.scoreReport(engagement, { shotRef: 'relative' });
    return writeReportBundle({ root, engagement, outDir: options.outDir || parsed.outDir, report,
      shareable: options.shareable === true });
  } catch (error) { originalError = error; throw error; }
  finally {
    try { await store.close(); } catch (closeError) {
      if (originalError) throw new AggregateError([originalError, closeError], `导出失败且无法关闭数据仓库：${originalError.message}`);
      throw closeError;
    }
  }
}
