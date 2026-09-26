const { setAlarmActivityAttributes } = require('./withAlarmActivity');

function manifestWithMainActivity() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            { $: { 'android:name': '.SomeOtherActivity' } },
            { $: { 'android:name': '.MainActivity', 'android:exported': 'true' } },
          ],
        },
      ],
    },
  };
}

test('sets showWhenLocked and turnScreenOn on .MainActivity only (spec §5.7: full-screen alarm over the lock screen)', () => {
  const result = setAlarmActivityAttributes(manifestWithMainActivity());
  const [other, main] = result.manifest.application[0].activity;
  expect(main.$).toEqual({
    'android:name': '.MainActivity',
    'android:exported': 'true',
    'android:showWhenLocked': 'true',
    'android:turnScreenOn': 'true',
  });
  expect(other.$).toEqual({ 'android:name': '.SomeOtherActivity' });
});

test('throws when there is no MainActivity to patch', () => {
  const manifest = { manifest: { $: {}, application: [{ $: {}, activity: [] }] } };
  expect(() => setAlarmActivityAttributes(manifest)).toThrow();
});
