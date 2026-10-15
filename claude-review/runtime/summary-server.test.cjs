'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summaryPublisher } = require('./summary-server.cjs');
const env = { REPO_OWNER: 'fixture', REPO_NAME: 'project', PR_NUMBER: '42', GITHUB_TOKEN: 'fixture-secret' };
const body = `Complete review.\n<!-- gumnut-review-verdict/v1 head=${'a'.repeat(40)} base=${'b'.repeat(40)} verdict=clean -->`;

test('summary target comes only from trusted identity, including forged tool arguments', async () => {
  let captured;
  const publish = summaryPublisher(env, async (url, options) => {
    captured = { url, options }; return { ok: true, json: async () => ({ id: 991, html_url: 'fixture-url' }) };
  });
  const result = await publish({ body, owner: 'other', repo: 'other', issue_number: 999, comment_id: 111 });
  assert.equal(result.isError, undefined);
  assert.equal(captured.url, 'https://api.github.com/repos/fixture/project/issues/42/comments');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(JSON.parse(captured.options.body).body, body);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('invalid summary identity fails before requests; API failures never disclose secrets', async () => {
  for (const patch of [{ PR_NUMBER: '42/../1' }, { REPO_OWNER: 'a/b' }, { GITHUB_TOKEN: '' }]) {
    assert.throws(() => summaryPublisher({ ...env, ...patch }));
  }
  let called = false;
  const publish = summaryPublisher(env, async () => { called = true; throw Error('fixture-secret'); });
  for (const invalid of ['', ' ', 'x'.repeat(65537), undefined]) assert.equal((await publish({ body: invalid })).isError, true);
  assert.equal(called, false);
  const result = await publish({ body });
  assert.equal(result.isError, true);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.equal((await summaryPublisher(env, async () => ({ ok: false }))({ body })).isError, true);
});
