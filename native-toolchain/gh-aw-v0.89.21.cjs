// Compatibility for this exact native release; repository policy stays in callers.
const fs = require('node:fs');
const SETUP = 'c35393777e5604a63721d09512263b1383301d4f';

function assertPinned(text) {
  if (!text.includes('"compiler_version":"v0.89.21"')) throw Error('expected gh-aw v0.89.21 metadata');
  const refs = [...text.matchAll(/uses: github\/gh-aw\/actions\/setup@([^\s]+)/g)];
  if (!refs.length || refs.some(match => match[1] !== SETUP)) throw Error('native setup action SHA drift');
}

function job(text, name, transform) {
  const pattern = new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-zA-Z_][\\w-]*:\\n|(?![\\s\\S]))`, 'gm');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw Error(`expected generated ${name} job`);
  return text.replace(pattern, transform);
}

function correctDetectorImages(source, generated) {
  assertPinned(generated);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const entries = [...(frontmatter || '').matchAll(/^      (agent|apiProxy|squid): (ghcr[^\n]+)$/gm)];
  const images = Object.fromEntries(entries.map(match => [match[1], match[2]]));
  if (entries.length !== 3 || Object.keys(images).length !== 3 ||
      Object.values(images).some(pin => !/^ghcr\.io\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(pin)))
    throw Error('expected three digest-qualified AWF images');
  return job(generated, 'detection', block => {
    for (const image of Object.values(images)) {
      const tag = image.split('@')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${tag}(?:@sha256:[a-f0-9]{64})?(?=$|[\\s'"\\]])`, 'gm');
      if (!pattern.test(block)) throw Error('detector image correction point drift');
      block = block.replace(pattern, image);
    }
    const config = /'(\{[^\n]*\})'(?= > [^\n]*awf-config\.json)/g;
    if ([...block.matchAll(config)].length !== 1) throw Error('detector configuration correction point drift');
    return block.replace(config, (_, json) => {
      const parsed = JSON.parse(json);
      if (!parsed.container || (parsed.container.imageTag !== '0.28.25' &&
          JSON.stringify(parsed.container.images) !== JSON.stringify(images)))
        throw Error('detector configuration correction point drift');
      delete parsed.container.imageTag;
      parsed.container.images = images;
      return `'${JSON.stringify(parsed)}'`;
    });
  });
}

function normalizeActionReferences(source, generated) {
  assertPinned(generated);
  let text = generated.replace(new RegExp(`(github/gh-aw/actions/setup@${SETUP})(?: # [^\\n]*)?$`, 'gm'), '$1 # v0.89.21');
  text = text.replaceAll(`"repo":"github/gh-aw/actions/setup","sha":"${SETUP}","version":"${SETUP}"`,
    `"repo":"github/gh-aw/actions/setup","sha":"${SETUP}","version":"v0.89.21"`);
  const annotations = new Map([...source.matchAll(/^\s*(?:- )?uses: (\S+@[a-f0-9]{40}) # (.+)$/gm)]
    .map(match => [match[1], match[2]]));
  text = text.replace(/^(\s*(?:- )?uses: )(\S+@[a-f0-9]{40})(?: # [^\n]*)?$/gm, (line, prefix, ref) =>
    annotations.has(ref) ? `${prefix}${ref} # ${annotations.get(ref)}` : line);
  const summary = `#   - github/gh-aw/actions/setup@${SETUP} # v0.89.21`;
  let seen = false;
  return text.split('\n').filter(line => {
    if (line !== summary) return true;
    if (seen) return false;
    seen = true;
    return true;
  }).join('\n');
}

function correctPublisherIssuesRead(_source, generated) {
  assertPinned(generated);
  let text = generated;
  for (const name of ['safe_outputs', 'conclusion']) text = job(text, name, block => {
    const pattern = /(      - name: Generate GitHub App token\n        id: safe-outputs-app-token\n[\s\S]*?)(?=      - name:|(?![\s\S]))/g;
    if ([...block.matchAll(pattern)].length !== 1) throw Error('expected two publisher token steps, one per publisher job');
    return block.replace(pattern, token => {
      const anchor = '          permission-pull-requests: write\n';
      if (token.split(anchor).length !== 2) throw Error('publisher permissions drift');
      const issues = [...token.matchAll(/^          permission-issues: (.+)$/gm)];
      if (issues.length > 1 || (issues.length === 1 && issues[0][1] !== 'read')) throw Error('publisher Issues permission drift');
      return issues.length ? token : token.replace(anchor, anchor + '          permission-issues: read\n');
    });
  });
  return text;
}

const operations = { correctDetectorImages, normalizeActionReferences, correctPublisherIssuesRead };
if (require.main === module) {
  const [source, lock, ...names] = process.argv.slice(2);
  if (!source || !lock || !names.length || new Set(names).size !== names.length ||
      names.some(name => !Object.hasOwn(operations, name)))
    throw Error('usage: node gh-aw-v0.89.21.cjs source.md workflow.lock.yml operation ...');
  const policy = fs.readFileSync(source, 'utf8');
  let text = fs.readFileSync(lock, 'utf8');
  for (const name of names) text = operations[name](policy, text);
  // A failed correction leaves the raw native lock unvalidated, never a partial correction.
  fs.writeFileSync(lock, text);
}
module.exports = operations;
