// Bounded generated corrections for gh-aw v0.89.21 and dependency-maintenance.
// Run from the consumer root; policy and credentials remain in its source.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const workflow = 'dependency-maintenance';
const setup = 'c35393777e5604a63721d09512263b1383301d4f';

function sourceSettings(source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if (!frontmatter) throw Error('expected workflow frontmatter');
  const imageEntries = [...frontmatter.matchAll(/^      (agent|apiProxy|squid): (ghcr[^\n]+)$/gm)].map(m => [m[1], m[2]]);
  const images = Object.fromEntries(imageEntries);
  if (imageEntries.length !== 3 || Object.keys(images).length !== 3 || Object.values(images).some(pin => !/^ghcr\.io\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(pin)))
    throw Error('expected three digest-qualified AWF images');
  const outputs = frontmatter.match(/^safe-outputs:\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m)?.[1];
  const environments = [...(outputs || '').matchAll(/^  environment: (.+)$/gm)];
  // Keep the caller's YAML scalar verbatim, including optional quotes. Objects
  // and expression-derived environments need a separately reviewed contract.
  if (environments.length !== 1 || !/^(?:[a-zA-Z0-9][\w .-]*|'[\w .-]+'|"[\w .-]+")$/.test(environments[0][1]))
    throw Error('expected one scalar safe-outputs environment');
  return { images, environment: environments[0][1] };
}

function correctWorkflow(source, generated) {
  const { images, environment } = sourceSettings(source);
  const sections = generated.split('\njobs:\n');
  if (sections.length !== 2) throw Error('expected generated jobs section');
  const seen = new Set();
  const jobs = sections[1].replace(/^  ([a-zA-Z_][\w-]*):\n[\s\S]*?(?=^  [a-zA-Z_][\w-]*:\n|(?![\s\S]))/gm, (block, name) => {
    if (seen.has(name)) throw Error('duplicate generated job');
    seen.add(name);
    if (name === 'pre_activation') {
      if (/\n    permissions:/.test(block) || !block.includes('\n    steps:')) throw Error('admission correction point drift');
      block = block.replace('\n    steps:', '\n    permissions:\n      contents: read\n      actions: read\n    steps:');
    }
    if (name === 'detection') {
      for (const image of Object.values(images)) {
        const tag = image.split('@')[0];
        if (!block.includes(tag)) throw Error('detector image correction point drift');
        block = block.split(tag).join(image).replaceAll(image + image.slice(image.indexOf('@')), image);
      }
      const tag = '"imageTag":"0.28.25"';
      if (block.split(tag).length !== 2) throw Error('detector configuration correction point drift');
      block = block.replace(tag, '"images":' + JSON.stringify(images));
    }
    // Native reviewer label checks use the Issues endpoint, despite PR write.
    let tokens = 0;
    block = block.replace(/(      - name: Generate GitHub App token\n        id: safe-outputs-app-token\n[\s\S]*?)(?=      - name:|$)/g, token => {
      if (!['safe_outputs', 'conclusion'].includes(name)) throw Error('publisher token job drift');
      tokens++;
      const anchor = '          permission-pull-requests: write\n';
      if (token.split(anchor).length !== 2) throw Error('publisher permissions drift');
      const issues = [...token.matchAll(/^          permission-issues: (.+)$/gm)];
      if (issues.length > 1 || (issues.length === 1 && issues[0][1] !== 'read')) throw Error('publisher Issues permission drift');
      return token.includes('          permission-issues: read\n') ? token : token.replace(anchor, anchor + '          permission-issues: read\n');
    });
    // The native compiler leaks the publisher environment onto unrelated jobs.
    const environmentLine = `    environment: ${environment}\n`;
    if (['safe_outputs', 'conclusion'].includes(name)) {
      if (tokens !== 1) throw Error('expected two publisher token steps, one per publisher job');
      if (block.split(environmentLine).length !== 2) throw Error('publisher environment drift');
    } else {
      block = block.replaceAll(environmentLine, '');
    }
    return block;
  });
  for (const name of ['pre_activation', 'detection', 'safe_outputs', 'conclusion'])
    if (!seen.has(name)) throw Error(`expected generated ${name} job`);
  let text = sections[0] + '\njobs:\n' + jobs;
  // Normalize API-resolved release labels for reproducible offline compilation.
  text = text.replace(new RegExp(`(github/gh-aw/actions/setup@${setup})(?: # [^\\n]*)?$`, 'gm'), '$1 # v0.89.21');
  text = text.replaceAll(`"repo":"github/gh-aw/actions/setup","sha":"${setup}","version":"${setup}"`, `"repo":"github/gh-aw/actions/setup","sha":"${setup}","version":"v0.89.21"`);
  // Source annotations are authoritative whether native compilation substitutes
  // a SHA, guesses a release label, or drops the annotation altogether.
  const annotations = new Map([...source.matchAll(/^\s*(?:- )?uses: (\S+@[a-f0-9]{40}) # (.+)$/gm)].map(m => [m[1], m[2]]));
  text = text.replace(/^(\s*(?:- )?uses: )(\S+@[a-f0-9]{40})(?: # [^\n]*)?$/gm, (line, prefix, ref) =>
    annotations.has(ref) ? `${prefix}${ref} # ${annotations.get(ref)}` : line);
  return text;
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
module.exports = { correctWorkflow };
