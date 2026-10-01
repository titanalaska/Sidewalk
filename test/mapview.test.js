// Matt's rule (10/1/26): warn only when NO photo loads at all.
const test = require('node:test');
const assert = require('node:assert');
const { photoUnavailable } = require('../lib/mapview.js');

test('both photos load: no banner', () => assert.strictEqual(photoUnavailable(true, true, true), false));
test('Esri down, MOA fine: MOA is a photo, no banner', () => assert.strictEqual(photoUnavailable(false, true, true), false));
test('Esri fine, MOA down: blurrier, still a photo, no banner', () => assert.strictEqual(photoUnavailable(true, false, true), false));
test('outside MOA, Esri fine: no banner', () => assert.strictEqual(photoUnavailable(true, false, false), false));
test('both down: banner', () => assert.strictEqual(photoUnavailable(false, false, true), true));
test('outside MOA, Esri down: banner', () => assert.strictEqual(photoUnavailable(false, false, false), true));
// A stray MOA "ok" outside its area can't count as a photo: MOA was never asked.
test('outside MOA, Esri down, moaOk somehow true: still banner', () => assert.strictEqual(photoUnavailable(false, true, false), true));
