// The Share button (Matt, 10/5/26): a worker texts the app to a new guy. A saved
// QR once sent someone to the wrong place, so what is shared is ALWAYS the one
// fixed address, never the page the sharer happens to be on.
const test = require('node:test');
const assert = require('node:assert/strict');
const SnowShare = require('../lib/share.js');

const URL = 'https://titanalaska.github.io/Sidewalk/';

function nav(o) {
  const calls = { share: [], copy: [] };
  const n = {};
  if (o.share) n.share = async (d) => { calls.share.push(d); return o.share(d); };
  if (o.copy) n.clipboard = { writeText: async (t) => { calls.copy.push(t); return o.copy(t); } };
  return { n, calls };
}
const abort = () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; };
const denied = () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; };

test('the address is the fixed app address, and the message says how to get in', () => {
  assert.equal(SnowShare.APP_URL, URL);
  const m = SnowShare.message();
  assert.match(m, /Snow Crew/);
  assert.match(m, /Request access/); // a new guy has no PIN yet
  assert.ok(!m.includes('http'), 'the link travels as the url, not inside the text');
});

test('with a share sheet: it opens with the fixed address, and nothing is copied', async () => {
  const { n, calls } = nav({ share: () => {}, copy: () => {} });
  assert.equal(await SnowShare.share(n), 'shared');
  assert.equal(calls.share.length, 1);
  assert.equal(calls.share[0].url, URL);
  assert.equal(calls.share[0].text, SnowShare.message());
  assert.equal(calls.copy.length, 0);
});

test('backing out of the share sheet is not a failure: nothing is copied', async () => {
  const { n, calls } = nav({ share: abort, copy: () => {} });
  assert.equal(await SnowShare.share(n), 'cancelled');
  assert.equal(calls.copy.length, 0);
});

test('a share sheet that refuses falls back to copying the message and the address', async () => {
  const { n, calls } = nav({ share: denied, copy: () => {} });
  assert.equal(await SnowShare.share(n), 'copied');
  assert.equal(calls.copy[0], SnowShare.message() + ' ' + URL);
});

test('no share sheet (a laptop browser): the message and the address are copied', async () => {
  const { n, calls } = nav({ copy: () => {} });
  assert.equal(await SnowShare.share(n), 'copied');
  assert.equal(calls.copy[0], SnowShare.message() + ' ' + URL);
});

test('nothing works: it says so, so the page can show the link to copy by hand', async () => {
  assert.equal(await SnowShare.share(nav({ copy: () => { throw new Error('blocked'); } }).n), 'show');
  assert.equal(await SnowShare.share(nav({}).n), 'show');
  assert.equal(await SnowShare.share(undefined), 'show');
});
