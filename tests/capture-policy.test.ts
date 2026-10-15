import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCapturePermission } from '../electron/capture-policy.cts';

test('allows only desktop capture, never microphone, camera, or ambiguous media', () => {
  assert.equal(isCapturePermission('display-capture'),true);
  assert.equal(isCapturePermission('media',[]),true);
  assert.equal(isCapturePermission('media',['audio']),false);
  assert.equal(isCapturePermission('media',['video']),false);
  assert.equal(isCapturePermission('media',['audio','video']),false);
  assert.equal(isCapturePermission('media'),false);
  assert.equal(isCapturePermission('geolocation',[]),false);
});
