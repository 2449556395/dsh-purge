/** Adapt reviewed host package layout changes without editing users' preset files. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const CONTROL = '@deepseek-ai/dsh-tool-subagent-control';
const LEGACY_LIST = `${CONTROL}/list-agents`;

/** Inspect the selected runtime first; unknown releases retain their original composition. */
export function detectPresetCompatibility(anchors) {
  for (const anchor of anchors.filter(Boolean)) {
    try {
      const metadata = createRequire(anchor).resolve(`${CONTROL}/package.json`);
      const pkg = JSON.parse(readFileSync(metadata, 'utf8'));
      return {
        combinedSubagentControl: ['0.2.2-alpha.2', '0.2.2-rc.1'].includes(pkg.version) && !Object.hasOwn(pkg.exports || {}, './list-agents'),
        controlVersion: pkg.version,
      };
    } catch { /* A profile may resolve its official packages from the installation anchor instead. */ }
  }
  return { combinedSubagentControl: false, controlVersion: null };
}

/** Remove only a redundant legacy row whose same-scope active parent already registers list_agents. */
export function adaptPresetPlugins(rows, compatibility) {
  const hasCombined = compatibility.combinedSubagentControl && rows.some(row => row.name === CONTROL && row.isolate === undefined && (row.disabled === false || row.disabled === undefined));
  return rows.filter(row => !(hasCombined && row.name === LEGACY_LIST && row.config === undefined && row.isolate === undefined && row.inject === undefined)).map(row => (
    row.group === true && Array.isArray(row.config)
      ? { ...row, config: adaptPresetPlugins(row.config, compatibility) }
      : row
  ));
}
