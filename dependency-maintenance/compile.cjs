// Bounded generated corrections for gh-aw v0.89.21 and dependency-maintenance.
// Run from the consumer root; policy and credentials remain in its source.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { correctDetectorImages, normalizeActionReferences, correctPublisherIssuesRead } = require('../native-toolchain/gh-aw-v0.89.21.cjs');
const workflow = 'dependency-maintenance';
const setup = 'c35393777e5604a63721d09512263b1383301d4f';

function correctOutputTransport(block) {
  const configPattern = /^          GH_AW_SAFE_OUTPUTS_CONFIG: ("[^\n]+")$/gm;
  const validationPattern = /^          GH_AW_VALIDATION_JSON: \|\n((?:            [^\n]*\n)+)/gm;
  const collector = "            const { main } = require(path.join(actionsDir, 'collect_ndjson_output.cjs'));\n            await main();";
  if ([...block.matchAll(configPattern)].length !== 1 || [...block.matchAll(validationPattern)].length !== 1 || block.split(collector).length !== 2)
    throw Error('native dependency output transport correction point drift');
  block = block.replace(configPattern, (_, quoted) => {
    const config = JSON.parse(JSON.parse(quoted));
    const handoff = config.handoff_dependency_pr;
    if (!config.push_to_pull_request_branch || !handoff?.inputs || (handoff.max !== undefined && handoff.max !== 100))
      throw Error('native dependency output configuration drift');
    // Native scripts have no source max setting. This is transport capacity,
    // not the caller's work cap; readiness and deduplication stay agent-owned.
    // -1 is not unlimited in the pinned collector: it rejects every item.
    handoff.max = 100;
    return `          GH_AW_SAFE_OUTPUTS_CONFIG: ${JSON.stringify(JSON.stringify(config))}`;
  });
  block = block.replace(validationPattern, (_, indented) => {
    const config = JSON.parse(indented.replace(/^            /gm, ''));
    const fields = config.push_to_pull_request_branch?.fields;
    if (!fields || JSON.stringify(Object.keys(fields).sort()) !== JSON.stringify(['branch', 'message', 'pull_request_number', 'repo']))
      throw Error('native dependency repair validation drift');
    // The native tool generates this baseline after resolving the local PR
    // head. The collector otherwise drops it as an undeclared field. Keep it
    // out of the model-facing input schema; the publisher still requires an
    // exact match and uses native expectedHeadOid for every signed mutation.
    fields.base_commit = { type: 'string', minLength: 40, maxLength: 40, pattern: '^[a-fA-F0-9]{40}$' };
    return `          GH_AW_VALIDATION_JSON: |\n${JSON.stringify(config, null, 2).split('\n').map(line => `            ${line}`).join('\n')}\n`;
  });
  // Native collection reports invalid/discarded intents in errors[] but leaves
  // the step green. Fail the agent so its existing success gate prevents any
  // partial publication. Reuse native errors; do not reclassify model output.
  return block.replace(collector, `${collector}\n            const collected = JSON.parse(require('fs').readFileSync(process.env.GH_AW_AGENT_OUTPUT, 'utf8'));\n            if (collected.errors.length) core.setFailed('Native safe-output collection reported errors; inspect the collector output.');`);
}

function assertAdmissionPermissions(block, location) {
  const lines = (block || '').trim().split('\n').map(line => line.trim()).sort();
  if (JSON.stringify(lines) !== JSON.stringify(['actions: read', 'contents: read']))
    throw Error(`expected ${location} Contents/Actions read permissions`);
}

function sourceSettings(source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if (!frontmatter) throw Error('expected workflow frontmatter');
  const triggers = frontmatter.match(/^on:\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1];
  const permissions = triggers?.match(/^  permissions:\n((?:    [^\n]+\n?)+)/m)?.[1];
  assertAdmissionPermissions(permissions, 'source on.permissions');
  const outputs = frontmatter.match(/^safe-outputs:\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1];
  const environments = [...(outputs || '').matchAll(/^  environment: (.+)$/gm)];
  // Keep the caller's YAML scalar verbatim, including optional quotes. Objects
  // and expression-derived environments need a separately reviewed contract.
  if (environments.length !== 1 || !/^(?:[a-zA-Z0-9][\w .-]*|'[\w .-]+'|"[\w .-]+")$/.test(environments[0][1]))
    throw Error('expected one scalar safe-outputs environment');
  return { environment: environments[0][1] };
}

function correctWorkflow(source, generated) {
  const { environment } = sourceSettings(source);
  generated = correctDetectorImages(source, generated);
  generated = normalizeActionReferences(source, generated);
  generated = correctPublisherIssuesRead(source, generated);
  const sections = generated.split('\njobs:\n');
  if (sections.length !== 2) throw Error('expected generated jobs section');
  const seen = new Set();
  const jobs = sections[1].replace(/^  ([a-zA-Z_][\w-]*):\n[\s\S]*?(?=^  [a-zA-Z_][\w-]*:\n|(?![\s\S]))/gm, (block, name) => {
    if (seen.has(name)) throw Error('duplicate generated job');
    seen.add(name);
    if (name === 'pre_activation') {
      const permissions = block.match(/^    permissions:\n((?:      [^\n]+\n?)+)/m)?.[1];
      assertAdmissionPermissions(permissions, 'generated admission');
    }
    if (name === 'agent') block = correctOutputTransport(block);
    if (name === 'safe_outputs' && !block.includes("needs.agent.result == 'success'"))
      throw Error('dependency publication requires successful agent collection');
    if (!['safe_outputs', 'conclusion'].includes(name) && block.includes('id: safe-outputs-app-token'))
      throw Error('publisher token job drift');
    // The native compiler leaks the publisher environment onto unrelated jobs.
    const environmentLine = `    environment: ${environment}\n`;
    if (['safe_outputs', 'conclusion'].includes(name)) {
      if (block.split(environmentLine).length !== 2) throw Error('publisher environment drift');
    } else {
      block = block.replaceAll(environmentLine, '');
    }
    return block;
  });
  for (const name of ['pre_activation', 'agent', 'detection', 'safe_outputs', 'conclusion'])
    if (!seen.has(name)) throw Error(`expected generated ${name} job`);
  return sections[0] + '\njobs:\n' + jobs;
}

function main(compiler) {
  if (!compiler || process.argv.length !== 3) throw Error('usage: node /path/to/automation/dependency-maintenance/compile.cjs /path/to/gh-aw');
  const source = fs.readFileSync(`.github/workflows/${workflow}.md`, 'utf8');
  sourceSettings(source);
  execFileSync(compiler, ['compile', workflow, '--action-tag', setup, '--no-check-update'], { stdio: 'inherit' });
  const lock = `.github/workflows/${workflow}.lock.yml`;
  // Validate every correction before writing any corrected output. On failure,
  // the raw native lockfile is unvalidated and must not be committed/deployed.
  const corrected = correctWorkflow(source, fs.readFileSync(lock, 'utf8'));
  fs.writeFileSync(lock, corrected);
}

if (require.main === module) main(process.argv[2]);
module.exports = { correctWorkflow, correctOutputTransport };
