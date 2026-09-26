const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * Lets the arrival/GPS-loss/low-battery alarm's full-screen intent show
 * MainActivity over the keyguard and wake the screen (spec §5.7, §9):
 * android:showWhenLocked + android:turnScreenOn on .MainActivity.
 * android/ is generated (Continuous Native Generation), so this must live in
 * a config plugin rather than a hand edit of AndroidManifest.xml.
 */
function setAlarmActivityAttributes(androidManifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  mainActivity.$['android:showWhenLocked'] = 'true';
  mainActivity.$['android:turnScreenOn'] = 'true';
  return androidManifest;
}

function withAlarmActivity(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = setAlarmActivityAttributes(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAlarmActivity;
module.exports.setAlarmActivityAttributes = setAlarmActivityAttributes;
