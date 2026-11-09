import test from 'node:test';
import assert from 'node:assert/strict';
import { rewritePromptAssembly, installAssembleGuard } from '../lib/identity.js';

test('latest presentation preserves provider-owned fields without inventing tools', () => {
  const variables = { provider: 'fixture', model: 'fixture' };
  const original = { sections: [], contexts: [], variables, extra: { preserved: true } };
  const out = rewritePromptAssembly(original, 'Fixture prompt.', { capabilityProtocol: false });
  assert.equal(Object.hasOwn(out, 'tools'), false);
  assert.equal(out.variables, variables);
  assert.equal(out.extra, original.extra);
  assert.deepEqual(original.sections, []);
  assert.ok(out.sections.some((s) => s.name === 'dsh-purge'));
  assert.ok(out.sections.every((s) => !s.text.includes('{{cwd}}')));
});

test('legacy assembly retains original tool array and supported cwd variable', () => {
  const tools = [{ name: 'fixture' }];
  const original = { sections: [], contexts: [], tools, variables: { cwd: '/fixture' } };
  const out = rewritePromptAssembly(original, 'Fixture prompt.', { capabilityProtocol: false });
  assert.equal(out.tools, tools);
  assert.ok(out.sections.some((s) => s.text.includes('{{cwd}}')));
});

test('literal prompt content is not silently interpolated or rewritten', () => {
  const original = { sections: [{ name: 'fixture', text: '{{cwd}} [cwd]', interpolate: false }], contexts: [], variables: {} };
  const out = rewritePromptAssembly(original, '', { capabilityProtocol: false });
  assert.equal(out.sections.find((s) => s.name === 'fixture').text, '{{cwd}} [cwd]');
});

test('native assembly failure remains a visible failure, never fake empty success', async () => {
  const failure = new Error('fixture assembly failure');
  const prompt = { assemble: async () => { throw failure; } };
  installAssembleGuard(prompt, (value) => value);
  await assert.rejects(prompt.assemble({}), (error) => error === failure);
});
