# Caller Man Android MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Android-first MVP of Caller Man, a GPS-proximity alarm app: pick a destination, and get alarmed when you come within a configurable radius, without needing a set time.

**Architecture:** Expo (TypeScript, dev-client — not Expo Go) React Native app. A background `expo-location` + `expo-task-manager` task polls GPS at an interval it recomputes on every fix (interpolated between user-set min/max, based on remaining distance), checks the fix against the journey's radius, and fires a full-screen `notifee` alarm on arrival. All state lives in local SQLite (`expo-sqlite`) behind a small `Db` interface, so business logic (repositories, geo math, estimation) is dependency-injected and unit-testable with `better-sqlite3` in Jest, independent of the React Native runtime.

**Tech Stack:** Expo + TypeScript, React Navigation (native-stack), expo-location, expo-task-manager, expo-sqlite, expo-battery, @notifee/react-native (alarm/full-screen notifications), @rnmapbox/maps, @react-native-community/slider, Jest + jest-expo + @testing-library/react-native, better-sqlite3 (test-only SQL engine).

**Spec:** `docs/superpowers/specs/2026-09-22-caller-man-design.md`

## Global Constraints

- Android-first only for this plan; iOS is explicitly out of scope (spec §3).
- Only one active journey may exist at a time (spec §4) — enforced in the data layer.
- Metric units only — km/m, no imperial toggle (spec §10).
- No accounts, login, cloud sync, or data collection beyond core functionality (spec §2, §10).
- Alarm radius: 5–200 km via slider, any positive value via custom input; capped at 40% of the current distance to the destination, auto-adjusted down if a destination change would exceed the cap (spec §5.3).
- Max GPS poll frequency must always stay greater than min poll frequency; changing one auto-adjusts the other rather than allowing an invalid state (spec §5.3).
- A journey's low-battery cutoff is capped at `current battery − 5%` (floored at 0%) when the device's current battery is already below the default cutoff (spec §5.3, §8.5).
- Snooze duration is a configurable field in Default Settings (added during brainstorming, confirmed by user).
- Trip route/trail detail view is out of scope — history only needs the summary fields already on `journeys` (spec §10).
- Requires an Expo dev-client / prebuilt native project — not compatible with Expo Go, since both Mapbox and the background-location foreground service need native code (spec §7).
- `react-native-background-geolocation` (paid library) is explicitly NOT used for this phase — Android's built-in `expo-location` foreground-service support is sufficient (spec §7).
- The spec's polling-interval algorithm is deliberately decoupled from the speed/ETA estimate (§8.2 vs §8.3) — never let the estimate influence how often we poll.

## Review Focus

- GPS signal loss beyond the configured grace period must raise an alert, not silently stop tracking (spec §8.4) — Task 15.
- Starting a journey when current battery is already below the default cutoff must cap the selectable cutoff at `current − 5%`, clamped to a floor of 0% rather than going negative (spec §8.5) — Task 8.
- Only one active journey may exist at a time, enforced at the repository layer (not just the UI) since other code could call it directly (spec §4) — Task 11.
- Poll-interval interpolation must not divide by zero or go negative/out-of-range when the destination is at (or extremely near) the start location, or when the user moves away from the destination mid-journey (ratio > 1) (spec §8.2) — Task 6.
- Radius auto-adjustment on destination change must never silently exceed the 40%-of-distance cap, including the edge case where the new distance is very small (spec §5.3) — Task 5.

## File Structure

```
app.json                          Expo config: name, Android permissions, plugins, Mapbox token
App.tsx                           Root: runs migrations, resolves cold-start route, notifee listeners
index.ts                          Expo entry point (registerRootComponent)
babel.config.js, tsconfig.json    Standard Expo/TS config
package.json                      Deps + jest-expo config

src/types/journey.ts              Journey, DefaultSettings, LocationFix types
src/constants/limits.ts           Radius/frequency/battery/snooze bounds

src/geo/haversine.ts              Great-circle distance between two lat/lngs
src/geo/radiusCap.ts              40%-of-distance radius cap
src/geo/pollFrequency.ts          Distance-ratio interpolation → poll interval
src/geo/pollFreqOrdering.ts       Min/max frequency slider reconciliation
src/geo/batteryCutoff.ts          Battery-cutoff cap when already below default
src/geo/estimation.ts             Rolling average speed + ETA (informational only)

src/db/types.ts                   Db interface (execAsync/runAsync/getAllAsync/getFirstAsync)
src/db/expoSqliteClient.ts        App-runtime Db adapter over expo-sqlite
src/db/testDb.ts                  In-memory Db adapter over better-sqlite3, for tests
src/db/migrations.ts              Schema creation + default_settings seed row
src/db/journeysRepo.ts            Journeys CRUD, single-active-journey enforcement
src/db/settingsRepo.ts            Default settings read/write
src/db/locationLogRepo.ts         Location fix insert/query/prune

src/location/taskName.ts          Shared TaskManager task name constant
src/location/decideNextAction.ts  Pure: radius check + next interval + ETA (per fix)
src/location/gpsWatchdog.ts       Pure staleness check + setInterval wiring
src/location/backgroundTask.ts    TaskManager.defineTask glue (device-tested)
src/location/locationService.ts   start/stop tracking, battery listener glue (device-tested)

src/alarm/alarmChannel.ts         notifee Android channel (bypassDnd, ALARM category)
src/alarm/alarmManager.ts         triggerAlarm / triggerGpsLossAlert / triggerLowBatteryAlert

src/navigation/types.ts           RootStackParamList
src/navigation/resolveInitialRoute.ts  Pure: active journey → initial route
src/navigation/RootNavigator.tsx  Stack navigator wiring all screens

src/components/SliderWithCustomInput.tsx  Reusable slider + custom-value toggle
src/components/JourneyCard.tsx    Journey list card

src/screens/WelcomeScreen.tsx         First-boot permissions
src/screens/AboutScreen.tsx           Static about/donate
src/screens/DefaultSettingsScreen.tsx Default values incl. snooze/GPS-loss grace
src/screens/JourneysScreen.tsx        Home list + FAB
src/screens/NewJourneyScreen.tsx      Map picker + business-rule-validated form
src/screens/CurrentJourneyScreen.tsx  Live map + info panel + cancel
src/screens/AlarmScreen.tsx           Full-screen alarm/gps-loss/low-battery takeover
```

Every `*.ts`/`*.tsx` source file above has a co-located `*.test.ts`/`*.test.tsx`.

---

### Task 1: Scaffold Expo TypeScript project

**Files:**
- Create: `app.json`, `package.json`, `tsconfig.json`, `babel.config.js`, `App.tsx` (placeholder), `index.ts`, `.gitignore`

**Interfaces:**
- Produces: a runnable Expo TS project with `npm test` wired to `jest-expo`.

- [ ] **Step 1: Scaffold into a temp directory, then merge into the repo**

```bash
npx create-expo-app@latest /tmp/caller-man-scaffold --template blank-typescript
rsync -a --exclude='.git' /tmp/caller-man-scaffold/ /workspaces/caller-man/
rm -rf /tmp/caller-man-scaffold
```

- [ ] **Step 2: Set app identity in `app.json`**

```json
{
  "expo": {
    "name": "Caller Man",
    "slug": "caller-man",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "dark",
    "android": {
      "package": "com.callerman.app"
    }
  }
}
```

- [ ] **Step 3: Add Jest + testing-library dev dependencies and configure**

```bash
npx expo install jest-expo jest @types/jest --dev
npm install --save-dev @testing-library/react-native better-sqlite3 @types/better-sqlite3
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|@notifee/react-native|@rnmapbox/maps)"
    ]
  }
}
```

- [ ] **Step 4: Verify the template test suite runs**

Run: `npm test`
Expected: Jest runs (0 or the template's default test passes) with no configuration errors.

- [ ] **Step 5: Commit**

```bash
git add app.json package.json tsconfig.json babel.config.js App.tsx index.ts .gitignore package-lock.json
git commit -m "Scaffold Expo TypeScript project with Jest"
```

---

### Task 2: Install native dependencies & Android config

**Files:**
- Modify: `app.json`

**Interfaces:**
- Produces: all native packages installed and linked via Expo config plugins; Android manifest permissions declared.

- [ ] **Step 1: Install Expo-managed native deps (SDK-matched versions)**

```bash
npx expo install expo-location expo-task-manager expo-sqlite expo-battery \
  expo-notifications expo-dev-client expo-build-properties
```

- [ ] **Step 2: Install remaining native/JS deps**

```bash
npm install @notifee/react-native @rnmapbox/maps \
  @react-navigation/native @react-navigation/native-stack \
  react-native-screens react-native-safe-area-context \
  @react-native-community/slider
```

- [ ] **Step 3: Declare Android permissions and plugins in `app.json`**

```json
{
  "expo": {
    "android": {
      "package": "com.callerman.app",
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "POST_NOTIFICATIONS",
        "USE_FULL_SCREEN_INTENT",
        "VIBRATE",
        "WAKE_LOCK"
      ]
    },
    "plugins": [
      "expo-location",
      "expo-task-manager",
      "@notifee/react-native",
      [
        "@rnmapbox/maps",
        { "RNMapboxMapsDownloadToken": "REPLACE_WITH_YOUR_MAPBOX_DOWNLOAD_TOKEN" }
      ],
      ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
    ]
  }
}
```

Note: `RNMapboxMapsDownloadToken` is a real Mapbox secret token you must obtain from your own Mapbox account (needed to download the native SDK at build time) — this is a credential, not a placeholder to be resolved by writing more plan.

- [ ] **Step 4: Generate the native Android project (dev-client)**

```bash
npx expo prebuild --platform android
```

Expected: an `android/` directory is generated; this is the dev-client build the app runs on (`npx expo run:android` for local device/emulator testing throughout later tasks).

- [ ] **Step 5: Commit**

```bash
git add app.json package.json package-lock.json android
git commit -m "Install native dependencies and configure Android permissions/plugins"
```

---

### Task 3: Core types & limits constants

**Files:**
- Create: `src/types/journey.ts`, `src/constants/limits.ts`

**Interfaces:**
- Produces: `Journey`, `DefaultSettings`, `LocationFix`, `JourneyStatus` types; numeric bound constants used throughout later tasks.

- [ ] **Step 1: Write the types**

```ts
// src/types/journey.ts
export type JourneyStatus = 'active' | 'completed' | 'cancelled';

export interface Journey {
  id: number;
  name: string;
  destinationLat: number;
  destinationLng: number;
  radiusM: number;
  maxPollFreqPerMin: number;
  minPollFreqPerMin: number;
  alarmTune: string;
  batteryCutoffPct: number;
  snoozeMinutes: number;
  gpsLossGraceMinutes: number;
  initialDistanceM: number;
  lastFixAt: number | null;
  status: JourneyStatus;
  createdAt: number;
  completedAt: number | null;
}

export interface DefaultSettings {
  radiusM: number;
  maxPollFreqPerMin: number;
  minPollFreqPerMin: number;
  alarmTune: string;
  batteryCutoffPct: number;
  snoozeMinutes: number;
  gpsLossGraceMinutes: number;
}

export interface LocationFix {
  id: number;
  journeyId: number;
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  recordedAt: number;
}
```

```ts
// src/constants/limits.ts
export const RADIUS_MIN_M = 5_000;
export const RADIUS_MAX_M = 200_000;
export const RADIUS_MAX_FRACTION_OF_DISTANCE = 0.4;
export const POLL_FREQ_MIN_PER_MIN = 1;
export const POLL_FREQ_MAX_PER_MIN = 200;
export const BATTERY_CUTOFF_SAFETY_MARGIN_PCT = 5;
export const BATTERY_CUTOFF_FLOOR_PCT = 0;
export const SNOOZE_MINUTES_MIN = 1;
export const SNOOZE_MINUTES_MAX = 15;
export const GPS_LOSS_GRACE_MINUTES_MIN = 1;
export const GPS_LOSS_GRACE_MINUTES_MAX = 30;
```

There is no test for this task — it's pure declarations with nothing to assert yet; later tasks' tests exercise these values.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/journey.ts src/constants/limits.ts
git commit -m "Add core Journey/DefaultSettings types and limit constants"
```

---

### Task 4: Geo — haversine distance

**Files:**
- Create: `src/geo/haversine.ts`, `src/geo/haversine.test.ts`

**Interfaces:**
- Produces: `haversineDistanceM(a: LatLng, b: LatLng): number`, `LatLng` type — used by every distance/radius calculation in later tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/haversine.test.ts
import { haversineDistanceM } from './haversine';

test('distance between identical points is 0', () => {
  expect(haversineDistanceM({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBe(0);
});

test('1 degree of latitude is approximately 111.32 km', () => {
  const d = haversineDistanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  expect(d).toBeGreaterThan(110_500);
  expect(d).toBeLessThan(111_500);
});

test('distance is symmetric', () => {
  const a = { lat: 51.5074, lng: -0.1278 };
  const b = { lat: 48.8566, lng: 2.3522 };
  expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/haversine.test.ts`
Expected: FAIL — `Cannot find module './haversine'`

- [ ] **Step 3: Implement**

```ts
// src/geo/haversine.ts
const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  lat: number;
  lng: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/haversine.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/haversine.ts src/geo/haversine.test.ts
git commit -m "Add haversine distance calculation"
```

---

### Task 5: Geo — radius cap (40% of distance)

**Files:**
- Create: `src/geo/radiusCap.ts`, `src/geo/radiusCap.test.ts`

**Interfaces:**
- Consumes: nothing (pure math against `RADIUS_MAX_FRACTION_OF_DISTANCE` from Task 3).
- Produces: `maxAllowedRadiusM(distanceM): number`, `clampRadiusToCap(radiusM, distanceM): number` — used by Task 25 (New Journey screen).

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/radiusCap.test.ts
import { maxAllowedRadiusM, clampRadiusToCap } from './radiusCap';

test('max allowed radius is 40% of the distance', () => {
  expect(maxAllowedRadiusM(10_000)).toBe(4_000);
});

test('radius under the cap is left unchanged', () => {
  expect(clampRadiusToCap(2_000, 10_000)).toBe(2_000);
});

test('radius over the cap is clamped down to the cap', () => {
  expect(clampRadiusToCap(9_000, 10_000)).toBe(4_000);
});

test('destination at the current location caps radius to 0', () => {
  expect(clampRadiusToCap(5_000, 0)).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/radiusCap.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/geo/radiusCap.ts
import { RADIUS_MAX_FRACTION_OF_DISTANCE } from '../constants/limits';

export function maxAllowedRadiusM(distanceToDestinationM: number): number {
  return distanceToDestinationM * RADIUS_MAX_FRACTION_OF_DISTANCE;
}

export function clampRadiusToCap(radiusM: number, distanceToDestinationM: number): number {
  return Math.min(radiusM, maxAllowedRadiusM(distanceToDestinationM));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/radiusCap.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/radiusCap.ts src/geo/radiusCap.test.ts
git commit -m "Add 40%-of-distance radius cap"
```

---

### Task 6: Geo — poll-frequency interpolation

**Files:**
- Create: `src/geo/pollFrequency.ts`, `src/geo/pollFrequency.test.ts`

**Interfaces:**
- Produces: `clamp01(x): number`, `interpolatePollFreqPerMin(remainingM, initialM, minFreq, maxFreq): number`, `freqPerMinToIntervalMs(freqPerMin): number` — used by Task 14 (`decideNextAction`) and Task 17 (`locationService`).

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/pollFrequency.test.ts
import { clamp01, interpolatePollFreqPerMin, freqPerMinToIntervalMs } from './pollFrequency';

test('clamp01 bounds values to [0, 1]', () => {
  expect(clamp01(-5)).toBe(0);
  expect(clamp01(0.5)).toBe(0.5);
  expect(clamp01(5)).toBe(1);
  expect(clamp01(NaN)).toBe(0);
});

test('at the initial distance, frequency is the minimum', () => {
  expect(interpolatePollFreqPerMin(10_000, 10_000, 5, 20)).toBe(5);
});

test('at the destination, frequency is the maximum', () => {
  expect(interpolatePollFreqPerMin(0, 10_000, 5, 20)).toBe(20);
});

test('halfway there, frequency is halfway between min and max', () => {
  expect(interpolatePollFreqPerMin(5_000, 10_000, 5, 20)).toBeCloseTo(12.5, 5);
});

test('moving away from the destination (remaining > initial) does not exceed the minimum', () => {
  expect(interpolatePollFreqPerMin(15_000, 10_000, 5, 20)).toBe(5);
});

test('a zero initial distance (destination at start) returns the maximum, no division by zero', () => {
  expect(interpolatePollFreqPerMin(0, 0, 5, 20)).toBe(20);
  expect(Number.isFinite(interpolatePollFreqPerMin(100, 0, 5, 20))).toBe(true);
});

test('freqPerMinToIntervalMs converts per-minute frequency to a millisecond interval', () => {
  expect(freqPerMinToIntervalMs(60)).toBe(1_000);
  expect(freqPerMinToIntervalMs(1)).toBe(60_000);
});

test('freqPerMinToIntervalMs rejects a non-positive frequency', () => {
  expect(() => freqPerMinToIntervalMs(0)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/pollFrequency.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/geo/pollFrequency.ts
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function interpolatePollFreqPerMin(
  remainingDistanceM: number,
  initialDistanceM: number,
  minFreqPerMin: number,
  maxFreqPerMin: number
): number {
  if (initialDistanceM <= 0) {
    return maxFreqPerMin;
  }
  const traveledRatio = clamp01(1 - remainingDistanceM / initialDistanceM);
  return minFreqPerMin + (maxFreqPerMin - minFreqPerMin) * traveledRatio;
}

export function freqPerMinToIntervalMs(freqPerMin: number): number {
  if (freqPerMin <= 0) {
    throw new Error('freqPerMin must be > 0');
  }
  return Math.round(60_000 / freqPerMin);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/pollFrequency.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/pollFrequency.ts src/geo/pollFrequency.test.ts
git commit -m "Add distance-ratio poll-frequency interpolation"
```

---

### Task 7: Geo — min/max frequency reconciliation

**Files:**
- Create: `src/geo/pollFreqOrdering.ts`, `src/geo/pollFreqOrdering.test.ts`

**Interfaces:**
- Produces: `reconcileMinMaxFreq(changed, minFreqPerMin, maxFreqPerMin): { minFreqPerMin, maxFreqPerMin }` — used by Task 23 (Default Settings screen) and Task 25 (New Journey screen).

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/pollFreqOrdering.test.ts
import { reconcileMinMaxFreq } from './pollFreqOrdering';

test('leaves a valid min < max pair unchanged', () => {
  expect(reconcileMinMaxFreq('min', 5, 20)).toEqual({ minFreqPerMin: 5, maxFreqPerMin: 20 });
});

test('raising min above max pulls max up with it', () => {
  expect(reconcileMinMaxFreq('min', 25, 20)).toEqual({ minFreqPerMin: 25, maxFreqPerMin: 26 });
});

test('lowering max below min pulls min down with it', () => {
  expect(reconcileMinMaxFreq('max', 5, 3)).toEqual({ minFreqPerMin: 2, maxFreqPerMin: 3 });
});

test('lowering max never pulls min below 1', () => {
  expect(reconcileMinMaxFreq('max', 1, 0)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 0 });
});
```

Note on the last case: `max=0` is itself invalid input (frequencies must be positive); the reconciliation function only fixes ordering, so `POLL_FREQ_MIN_PER_MIN` must still be enforced by the slider's own min bound in the UI (Task 19/23/25) — reconciliation isn't a substitute for the input bounds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/pollFreqOrdering.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/geo/pollFreqOrdering.ts
export function reconcileMinMaxFreq(
  changed: 'min' | 'max',
  minFreqPerMin: number,
  maxFreqPerMin: number
): { minFreqPerMin: number; maxFreqPerMin: number } {
  if (minFreqPerMin < maxFreqPerMin) {
    return { minFreqPerMin, maxFreqPerMin };
  }
  if (changed === 'min') {
    return { minFreqPerMin, maxFreqPerMin: minFreqPerMin + 1 };
  }
  return { minFreqPerMin: Math.max(1, maxFreqPerMin - 1), maxFreqPerMin };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/pollFreqOrdering.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/pollFreqOrdering.ts src/geo/pollFreqOrdering.test.ts
git commit -m "Add min/max poll frequency reconciliation"
```

---

### Task 8: Geo — battery cutoff cap

**Files:**
- Create: `src/geo/batteryCutoff.ts`, `src/geo/batteryCutoff.test.ts`

**Interfaces:**
- Produces: `maxAllowedBatteryCutoffPct(currentBatteryPct, defaultCutoffPct): number` — used by Task 25 (New Journey screen). Covers **Review Focus** item on battery-cutoff flooring.

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/batteryCutoff.test.ts
import { maxAllowedBatteryCutoffPct } from './batteryCutoff';

test('current battery above the default cutoff leaves the default unchanged', () => {
  expect(maxAllowedBatteryCutoffPct(50, 15)).toBe(15);
});

test('current battery already below the default cutoff caps at current minus 5', () => {
  expect(maxAllowedBatteryCutoffPct(10, 15)).toBe(5);
});

test('the cap never goes negative — floors at 0', () => {
  expect(maxAllowedBatteryCutoffPct(3, 15)).toBe(0);
  expect(maxAllowedBatteryCutoffPct(0, 15)).toBe(0);
});

test('current battery exactly equal to the default cutoff leaves it unchanged', () => {
  expect(maxAllowedBatteryCutoffPct(15, 15)).toBe(15);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/batteryCutoff.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/geo/batteryCutoff.ts
import { BATTERY_CUTOFF_SAFETY_MARGIN_PCT, BATTERY_CUTOFF_FLOOR_PCT } from '../constants/limits';

export function maxAllowedBatteryCutoffPct(
  currentBatteryPct: number,
  defaultCutoffPct: number
): number {
  if (currentBatteryPct >= defaultCutoffPct) {
    return defaultCutoffPct;
  }
  return Math.max(BATTERY_CUTOFF_FLOOR_PCT, currentBatteryPct - BATTERY_CUTOFF_SAFETY_MARGIN_PCT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/batteryCutoff.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/batteryCutoff.ts src/geo/batteryCutoff.test.ts
git commit -m "Add battery cutoff cap with floor at 0%"
```

---

### Task 9: Geo — speed/ETA estimation

**Files:**
- Create: `src/geo/estimation.ts`, `src/geo/estimation.test.ts`

**Interfaces:**
- Consumes: `haversineDistanceM`, `LatLng` (Task 4).
- Produces: `Fix` type, `averageSpeedMps(recentFixes, nowMs): number | null`, `estimateEta(remainingDistanceM, radiusM, avgSpeedMps): { etaSeconds, alarmEtaSeconds } | null` — used by Task 14 (`decideNextAction`) and Task 26 (Current Journey screen). **Informational only** — never feeds the polling-interval decision (Task 6/14).

- [ ] **Step 1: Write the failing test**

```ts
// src/geo/estimation.test.ts
import { averageSpeedMps, estimateEta, Fix } from './estimation';

const now = 1_000_000;

test('fewer than 2 fixes cannot produce a speed estimate', () => {
  const fixes: Fix[] = [{ lat: 0, lng: 0, recordedAt: now }];
  expect(averageSpeedMps(fixes, now)).toBeNull();
});

test('two fixes 1000m apart over 100s yields 10 m/s', () => {
  const fixes: Fix[] = [
    { lat: 0, lng: 0, recordedAt: now - 100_000 },
    { lat: 0.008983, lng: 0, recordedAt: now }, // ~1000m north at the equator
  ];
  expect(averageSpeedMps(fixes, now)).toBeCloseTo(10, 0);
});

test('fixes older than the estimation window are excluded', () => {
  const fixes: Fix[] = [
    { lat: 0, lng: 0, recordedAt: now - 10 * 60_000 }, // 10 min ago, outside window
    { lat: 0.008983, lng: 0, recordedAt: now },
  ];
  expect(averageSpeedMps(fixes, now)).toBeNull();
});

test('estimateEta returns null when speed is unknown or effectively stationary', () => {
  expect(estimateEta(1000, 200, null)).toBeNull();
  expect(estimateEta(1000, 200, 0.05)).toBeNull();
});

test('estimateEta computes arrival and alarm times from remaining distance and speed', () => {
  const eta = estimateEta(1000, 200, 10);
  expect(eta).toEqual({ etaSeconds: 100, alarmEtaSeconds: 80 });
});

test('estimateEta never returns a negative alarm ETA once already inside the radius', () => {
  const eta = estimateEta(100, 200, 10);
  expect(eta?.alarmEtaSeconds).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/geo/estimation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/geo/estimation.ts
import { haversineDistanceM } from './haversine';

export interface Fix {
  lat: number;
  lng: number;
  recordedAt: number;
}

const ESTIMATION_WINDOW_MS = 3 * 60 * 1000;

export function averageSpeedMps(recentFixes: Fix[], nowMs: number): number | null {
  const windowFixes = recentFixes
    .filter((f) => nowMs - f.recordedAt <= ESTIMATION_WINDOW_MS)
    .sort((a, b) => a.recordedAt - b.recordedAt);

  if (windowFixes.length < 2) {
    return null;
  }

  const first = windowFixes[0];
  const last = windowFixes[windowFixes.length - 1];
  const distanceM = haversineDistanceM(first, last);
  const elapsedS = (last.recordedAt - first.recordedAt) / 1000;
  if (elapsedS <= 0) {
    return null;
  }
  return distanceM / elapsedS;
}

export interface EtaEstimate {
  etaSeconds: number;
  alarmEtaSeconds: number;
}

export function estimateEta(
  remainingDistanceM: number,
  radiusM: number,
  avgSpeedMps: number | null
): EtaEstimate | null {
  if (avgSpeedMps === null || avgSpeedMps <= 0.1) {
    return null;
  }
  return {
    etaSeconds: remainingDistanceM / avgSpeedMps,
    alarmEtaSeconds: Math.max(0, remainingDistanceM - radiusM) / avgSpeedMps,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/geo/estimation.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/geo/estimation.ts src/geo/estimation.test.ts
git commit -m "Add rolling-average speed and ETA estimation"
```

---

### Task 10: DB — interface, adapters, migrations

**Files:**
- Create: `src/db/types.ts`, `src/db/expoSqliteClient.ts`, `src/db/testDb.ts`, `src/db/migrations.ts`, `src/db/migrations.test.ts`

**Interfaces:**
- Produces: `Db` interface; `getDb(): Promise<Db>` (app runtime, expo-sqlite); `createInMemoryDb(): Db` (test-only, better-sqlite3); `runMigrations(db: Db): Promise<void>`. All later DB repos (Tasks 11–13) take `db: Db` as an explicit parameter rather than importing `getDb()` themselves, so tests can inject `createInMemoryDb()`.

- [ ] **Step 1: Write the `Db` interface**

```ts
// src/db/types.ts
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    params?: unknown[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}
```

- [ ] **Step 2: Write the app-runtime adapter**

```ts
// src/db/expoSqliteClient.ts
import * as SQLite from 'expo-sqlite';
import { Db } from './types';

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('callerman.db').then((sqliteDb) => ({
      execAsync: (sql: string) => sqliteDb.execAsync(sql),
      runAsync: (sql: string, params: unknown[] = []) => sqliteDb.runAsync(sql, params),
      getAllAsync: <T,>(sql: string, params: unknown[] = []) => sqliteDb.getAllAsync<T>(sql, params),
      getFirstAsync: <T,>(sql: string, params: unknown[] = []) => sqliteDb.getFirstAsync<T>(sql, params),
    }));
  }
  return dbPromise;
}
```

- [ ] **Step 3: Write the test-only in-memory adapter**

```ts
// src/db/testDb.ts
import Database from 'better-sqlite3';
import { Db } from './types';

export function createInMemoryDb(): Db {
  const sqlite = new Database(':memory:');
  return {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async runAsync(sql: string, params: unknown[] = []) {
      const info = sqlite.prepare(sql).run(...params);
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      const row = sqlite.prepare(sql).get(...params);
      return (row ?? null) as T | null;
    },
  };
}
```

- [ ] **Step 4: Write the failing migrations test**

```ts
// src/db/migrations.test.ts
import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';

test('migrations create the expected tables and seed default_settings', async () => {
  const db = createInMemoryDb();
  await runMigrations(db);

  const journeyTables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('journeys', 'default_settings', 'location_log')`
  );
  expect(journeyTables.map((t) => t.name).sort()).toEqual([
    'default_settings',
    'journeys',
    'location_log',
  ]);

  const settings = await db.getFirstAsync<{ radius_m: number }>(
    `SELECT radius_m FROM default_settings WHERE id = 1`
  );
  expect(settings?.radius_m).toBe(10000);
});

test('running migrations twice is safe (idempotent)', async () => {
  const db = createInMemoryDb();
  await runMigrations(db);
  await expect(runMigrations(db)).resolves.not.toThrow();
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx jest src/db/migrations.test.ts`
Expected: FAIL — `runMigrations` not defined

- [ ] **Step 6: Implement migrations**

```ts
// src/db/migrations.ts
import { Db } from './types';

export async function runMigrations(db: Db): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS journeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      radius_m REAL NOT NULL,
      max_poll_freq REAL NOT NULL,
      min_poll_freq REAL NOT NULL,
      alarm_tune TEXT NOT NULL,
      battery_cutoff_pct REAL NOT NULL,
      snooze_minutes REAL NOT NULL,
      gps_loss_grace_minutes REAL NOT NULL,
      initial_distance_m REAL NOT NULL,
      last_fix_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS default_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      radius_m REAL NOT NULL,
      max_poll_freq REAL NOT NULL,
      min_poll_freq REAL NOT NULL,
      alarm_tune TEXT NOT NULL,
      battery_cutoff_pct REAL NOT NULL,
      snooze_minutes REAL NOT NULL,
      gps_loss_grace_minutes REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS location_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journey_id INTEGER NOT NULL REFERENCES journeys(id),
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed_mps REAL,
      accuracy_m REAL,
      recorded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_location_log_journey ON location_log(journey_id, recorded_at);

    INSERT OR IGNORE INTO default_settings
      (id, radius_m, max_poll_freq, min_poll_freq, alarm_tune, battery_cutoff_pct, snooze_minutes, gps_loss_grace_minutes)
    VALUES (1, 10000, 20, 5, 'Radar Ping', 15, 3, 2);
  `);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest src/db/migrations.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/db/types.ts src/db/expoSqliteClient.ts src/db/testDb.ts src/db/migrations.ts src/db/migrations.test.ts
git commit -m "Add Db interface, expo-sqlite/test adapters, and schema migrations"
```

---

### Task 11: DB — journeys repository

**Files:**
- Create: `src/db/journeysRepo.ts`, `src/db/journeysRepo.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 10), `Journey`, `JourneyStatus` (Task 3).
- Produces: `ActiveJourneyExistsError`, `getActiveJourney(db)`, `getJourneyById(db, id)`, `listJourneys(db)`, `createJourney(db, input): Promise<Journey>`, `finishJourney(db, id, status)`, `updateLastFixAt(db, id, timestampMs)`. Used by Tasks 24–27 (screens) and Task 17 (background task glue).

- [ ] **Step 1: Write the failing tests**

```ts
// src/db/journeysRepo.test.ts
import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import {
  createJourney,
  getActiveJourney,
  getJourneyById,
  listJourneys,
  finishJourney,
  updateLastFixAt,
  ActiveJourneyExistsError,
} from './journeysRepo';

async function setup() {
  const db = createInMemoryDb();
  await runMigrations(db);
  return db;
}

const baseInput = {
  name: 'Home',
  destinationLat: 51.5,
  destinationLng: -0.12,
  radiusM: 1000,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5,
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 5000,
};

test('createJourney persists and returns the journey as active', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  expect(journey.status).toBe('active');
  expect(journey.id).toBeGreaterThan(0);
  expect(journey.lastFixAt).toBeNull();
});

test('createJourney rejects a second active journey', async () => {
  const db = await setup();
  await createJourney(db, baseInput);
  await expect(createJourney(db, baseInput)).rejects.toBeInstanceOf(ActiveJourneyExistsError);
});

test('createJourney is allowed again after the active one finishes', async () => {
  const db = await setup();
  const first = await createJourney(db, baseInput);
  await finishJourney(db, first.id, 'completed');
  await expect(createJourney(db, baseInput)).resolves.toBeDefined();
});

test('listJourneys returns newest first', async () => {
  const db = await setup();
  const a = await createJourney(db, baseInput);
  await finishJourney(db, a.id, 'completed');
  const b = await createJourney(db, baseInput);
  const list = await listJourneys(db);
  expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
});

test('getActiveJourney returns null when none active', async () => {
  const db = await setup();
  expect(await getActiveJourney(db)).toBeNull();
});

test('getJourneyById returns the matching journey', async () => {
  const db = await setup();
  const created = await createJourney(db, baseInput);
  const fetched = await getJourneyById(db, created.id);
  expect(fetched?.id).toBe(created.id);
});

test('updateLastFixAt persists the timestamp', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  await updateLastFixAt(db, journey.id, 123456);
  const fetched = await getJourneyById(db, journey.id);
  expect(fetched?.lastFixAt).toBe(123456);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/db/journeysRepo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/db/journeysRepo.ts
import { Db } from './types';
import { Journey, JourneyStatus } from '../types/journey';

interface JourneyRow {
  id: number;
  name: string;
  destination_lat: number;
  destination_lng: number;
  radius_m: number;
  max_poll_freq: number;
  min_poll_freq: number;
  alarm_tune: string;
  battery_cutoff_pct: number;
  snooze_minutes: number;
  gps_loss_grace_minutes: number;
  initial_distance_m: number;
  last_fix_at: number | null;
  status: JourneyStatus;
  created_at: number;
  completed_at: number | null;
}

function rowToJourney(row: JourneyRow): Journey {
  return {
    id: row.id,
    name: row.name,
    destinationLat: row.destination_lat,
    destinationLng: row.destination_lng,
    radiusM: row.radius_m,
    maxPollFreqPerMin: row.max_poll_freq,
    minPollFreqPerMin: row.min_poll_freq,
    alarmTune: row.alarm_tune,
    batteryCutoffPct: row.battery_cutoff_pct,
    snoozeMinutes: row.snooze_minutes,
    gpsLossGraceMinutes: row.gps_loss_grace_minutes,
    initialDistanceM: row.initial_distance_m,
    lastFixAt: row.last_fix_at,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class ActiveJourneyExistsError extends Error {
  constructor() {
    super('An active journey already exists; end it before starting a new one.');
    this.name = 'ActiveJourneyExistsError';
  }
}

export async function getActiveJourney(db: Db): Promise<Journey | null> {
  const row = await db.getFirstAsync<JourneyRow>(`SELECT * FROM journeys WHERE status = 'active' LIMIT 1`);
  return row ? rowToJourney(row) : null;
}

export async function getJourneyById(db: Db, id: number): Promise<Journey | null> {
  const row = await db.getFirstAsync<JourneyRow>(`SELECT * FROM journeys WHERE id = ?`, [id]);
  return row ? rowToJourney(row) : null;
}

export async function listJourneys(db: Db): Promise<Journey[]> {
  const rows = await db.getAllAsync<JourneyRow>(`SELECT * FROM journeys ORDER BY created_at DESC`);
  return rows.map(rowToJourney);
}

export interface CreateJourneyInput {
  name: string;
  destinationLat: number;
  destinationLng: number;
  radiusM: number;
  maxPollFreqPerMin: number;
  minPollFreqPerMin: number;
  alarmTune: string;
  batteryCutoffPct: number;
  snoozeMinutes: number;
  gpsLossGraceMinutes: number;
  initialDistanceM: number;
}

export async function createJourney(db: Db, input: CreateJourneyInput): Promise<Journey> {
  const existing = await getActiveJourney(db);
  if (existing) {
    throw new ActiveJourneyExistsError();
  }

  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO journeys
      (name, destination_lat, destination_lng, radius_m, max_poll_freq, min_poll_freq,
       alarm_tune, battery_cutoff_pct, snooze_minutes, gps_loss_grace_minutes,
       initial_distance_m, last_fix_at, status, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)`,
    [
      input.name,
      input.destinationLat,
      input.destinationLng,
      input.radiusM,
      input.maxPollFreqPerMin,
      input.minPollFreqPerMin,
      input.alarmTune,
      input.batteryCutoffPct,
      input.snoozeMinutes,
      input.gpsLossGraceMinutes,
      input.initialDistanceM,
      now,
    ]
  );

  const created = await getJourneyById(db, result.lastInsertRowId);
  if (!created) {
    throw new Error('Failed to read back created journey');
  }
  return created;
}

export async function finishJourney(db: Db, id: number, status: 'completed' | 'cancelled'): Promise<void> {
  await db.runAsync(`UPDATE journeys SET status = ?, completed_at = ? WHERE id = ?`, [status, Date.now(), id]);
}

export async function updateLastFixAt(db: Db, id: number, timestampMs: number): Promise<void> {
  await db.runAsync(`UPDATE journeys SET last_fix_at = ? WHERE id = ?`, [timestampMs, id]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/db/journeysRepo.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/journeysRepo.ts src/db/journeysRepo.test.ts
git commit -m "Add journeys repository with single-active-journey enforcement"
```

---

### Task 12: DB — default settings repository

**Files:**
- Create: `src/db/settingsRepo.ts`, `src/db/settingsRepo.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 10), `DefaultSettings` (Task 3).
- Produces: `getDefaultSettings(db): Promise<DefaultSettings>`, `saveDefaultSettings(db, settings): Promise<void>`. Used by Tasks 23 and 25.

- [ ] **Step 1: Write the failing test**

```ts
// src/db/settingsRepo.test.ts
import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import { getDefaultSettings, saveDefaultSettings } from './settingsRepo';

async function setup() {
  const db = createInMemoryDb();
  await runMigrations(db);
  return db;
}

test('getDefaultSettings reads the seeded row', async () => {
  const db = await setup();
  const settings = await getDefaultSettings(db);
  expect(settings).toEqual({
    radiusM: 10000,
    maxPollFreqPerMin: 20,
    minPollFreqPerMin: 5,
    alarmTune: 'Radar Ping',
    batteryCutoffPct: 15,
    snoozeMinutes: 3,
    gpsLossGraceMinutes: 2,
  });
});

test('saveDefaultSettings overwrites and getDefaultSettings reflects it', async () => {
  const db = await setup();
  await saveDefaultSettings(db, {
    radiusM: 20000,
    maxPollFreqPerMin: 30,
    minPollFreqPerMin: 10,
    alarmTune: 'Chime',
    batteryCutoffPct: 20,
    snoozeMinutes: 5,
    gpsLossGraceMinutes: 4,
  });
  const settings = await getDefaultSettings(db);
  expect(settings.radiusM).toBe(20000);
  expect(settings.alarmTune).toBe('Chime');
  expect(settings.snoozeMinutes).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/db/settingsRepo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/db/settingsRepo.ts
import { Db } from './types';
import { DefaultSettings } from '../types/journey';

interface SettingsRow {
  radius_m: number;
  max_poll_freq: number;
  min_poll_freq: number;
  alarm_tune: string;
  battery_cutoff_pct: number;
  snooze_minutes: number;
  gps_loss_grace_minutes: number;
}

function rowToSettings(row: SettingsRow): DefaultSettings {
  return {
    radiusM: row.radius_m,
    maxPollFreqPerMin: row.max_poll_freq,
    minPollFreqPerMin: row.min_poll_freq,
    alarmTune: row.alarm_tune,
    batteryCutoffPct: row.battery_cutoff_pct,
    snoozeMinutes: row.snooze_minutes,
    gpsLossGraceMinutes: row.gps_loss_grace_minutes,
  };
}

export async function getDefaultSettings(db: Db): Promise<DefaultSettings> {
  const row = await db.getFirstAsync<SettingsRow>(`SELECT * FROM default_settings WHERE id = 1`);
  if (!row) {
    throw new Error('default_settings row missing — did migrations run?');
  }
  return rowToSettings(row);
}

export async function saveDefaultSettings(db: Db, settings: DefaultSettings): Promise<void> {
  await db.runAsync(
    `UPDATE default_settings SET
      radius_m = ?, max_poll_freq = ?, min_poll_freq = ?, alarm_tune = ?,
      battery_cutoff_pct = ?, snooze_minutes = ?, gps_loss_grace_minutes = ?
     WHERE id = 1`,
    [
      settings.radiusM,
      settings.maxPollFreqPerMin,
      settings.minPollFreqPerMin,
      settings.alarmTune,
      settings.batteryCutoffPct,
      settings.snoozeMinutes,
      settings.gpsLossGraceMinutes,
    ]
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/db/settingsRepo.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/settingsRepo.ts src/db/settingsRepo.test.ts
git commit -m "Add default settings repository"
```

---

### Task 13: DB — location log repository

**Files:**
- Create: `src/db/locationLogRepo.ts`, `src/db/locationLogRepo.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 10), `LocationFix` (Task 3).
- Produces: `insertFix(db, journeyId, lat, lng, speedMps, accuracyM, recordedAt)`, `getRecentFixes(db, journeyId, sinceMs): Promise<LocationFix[]>`, `pruneFixesForJourney(db, journeyId)`. Used by Task 17 (background task) and Task 26 (Current Journey screen).

- [ ] **Step 1: Write the failing test**

```ts
// src/db/locationLogRepo.test.ts
import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import { insertFix, getRecentFixes, pruneFixesForJourney } from './locationLogRepo';
import { createJourney } from './journeysRepo';

async function setupWithJourney() {
  const db = createInMemoryDb();
  await runMigrations(db);
  const journey = await createJourney(db, {
    name: 'Home', destinationLat: 51.5, destinationLng: -0.12, radiusM: 1000,
    maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
    batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2, initialDistanceM: 5000,
  });
  return { db, journey };
}

test('insertFix and getRecentFixes round-trip in chronological order', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await insertFix(db, journey.id, 51.41, -0.1, 6, 10, 2000);

  const fixes = await getRecentFixes(db, journey.id, 0);
  expect(fixes.map((f) => f.recordedAt)).toEqual([1000, 2000]);
});

test('getRecentFixes excludes fixes before the given timestamp', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await insertFix(db, journey.id, 51.41, -0.1, 6, 10, 5000);

  const fixes = await getRecentFixes(db, journey.id, 3000);
  expect(fixes.map((f) => f.recordedAt)).toEqual([5000]);
});

test('pruneFixesForJourney deletes all fixes for that journey', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await pruneFixesForJourney(db, journey.id);

  const fixes = await getRecentFixes(db, journey.id, 0);
  expect(fixes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/db/locationLogRepo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/db/locationLogRepo.ts
import { Db } from './types';
import { LocationFix } from '../types/journey';

interface LogRow {
  id: number;
  journey_id: number;
  lat: number;
  lng: number;
  speed_mps: number | null;
  accuracy_m: number | null;
  recorded_at: number;
}

function rowToFix(row: LogRow): LocationFix {
  return {
    id: row.id,
    journeyId: row.journey_id,
    lat: row.lat,
    lng: row.lng,
    speedMps: row.speed_mps,
    accuracyM: row.accuracy_m,
    recordedAt: row.recorded_at,
  };
}

export async function insertFix(
  db: Db,
  journeyId: number,
  lat: number,
  lng: number,
  speedMps: number | null,
  accuracyM: number | null,
  recordedAt: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO location_log (journey_id, lat, lng, speed_mps, accuracy_m, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [journeyId, lat, lng, speedMps, accuracyM, recordedAt]
  );
}

export async function getRecentFixes(db: Db, journeyId: number, sinceMs: number): Promise<LocationFix[]> {
  const rows = await db.getAllAsync<LogRow>(
    `SELECT * FROM location_log WHERE journey_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC`,
    [journeyId, sinceMs]
  );
  return rows.map(rowToFix);
}

export async function pruneFixesForJourney(db: Db, journeyId: number): Promise<void> {
  await db.runAsync(`DELETE FROM location_log WHERE journey_id = ?`, [journeyId]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/db/locationLogRepo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/locationLogRepo.ts src/db/locationLogRepo.test.ts
git commit -m "Add location log repository"
```

---

### Task 14: Location — decideNextAction pure logic

**Files:**
- Create: `src/location/decideNextAction.ts`, `src/location/decideNextAction.test.ts`

**Interfaces:**
- Consumes: `haversineDistanceM` (Task 4), `interpolatePollFreqPerMin`, `freqPerMinToIntervalMs` (Task 6), `averageSpeedMps`, `estimateEta`, `Fix` (Task 9), `Journey` (Task 3).
- Produces: `FixInput` type, `NextAction` type (`{ type: 'alarm' } | { type: 'continue', ... }`), `decideNextAction(journey, fix, recentFixesForEstimation): NextAction`. This is the app's core correctness logic — used by Task 17's glue.

- [ ] **Step 1: Write the failing test**

```ts
// src/location/decideNextAction.test.ts
import { decideNextAction } from './decideNextAction';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null,
};

test('a fix inside the radius triggers the alarm', () => {
  const action = decideNextAction(baseJourney, { lat: 0.0001, lng: 0, speedMps: 1, accuracyM: 5, recordedAt: 1000 }, []);
  expect(action).toEqual({ type: 'alarm' });
});

test('a fix at the initial distance continues at the minimum frequency interval', () => {
  // ~10km north of the destination, matching initialDistanceM
  const action = decideNextAction(
    baseJourney,
    { lat: 0.0899, lng: 0, speedMps: 0, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.nextIntervalMs).toBe(12_000); // 60000 / 5/min
  }
});

test('a fix close to the destination continues at close to the maximum frequency interval', () => {
  const action = decideNextAction(
    baseJourney,
    { lat: 0.0009, lng: 0, speedMps: 5, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.nextIntervalMs).toBeLessThan(12_000);
    expect(action.nextIntervalMs).toBeGreaterThanOrEqual(3_000); // 60000 / 20/min
  }
});

test('includes a null ETA when there is not yet enough estimation data', () => {
  const action = decideNextAction(
    baseJourney,
    { lat: 0.01, lng: 0, speedMps: null, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.avgSpeedMps).toBeNull();
    expect(action.etaSeconds).toBeNull();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/location/decideNextAction.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/location/decideNextAction.ts
import { haversineDistanceM } from '../geo/haversine';
import { interpolatePollFreqPerMin, freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { averageSpeedMps, estimateEta, Fix } from '../geo/estimation';
import { Journey } from '../types/journey';

export interface FixInput {
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  recordedAt: number;
}

export type NextAction =
  | { type: 'alarm' }
  | {
      type: 'continue';
      nextIntervalMs: number;
      remainingDistanceM: number;
      avgSpeedMps: number | null;
      etaSeconds: number | null;
      alarmEtaSeconds: number | null;
    };

export function decideNextAction(
  journey: Journey,
  fix: FixInput,
  recentFixesForEstimation: Fix[]
): NextAction {
  const destination = { lat: journey.destinationLat, lng: journey.destinationLng };
  const remainingDistanceM = haversineDistanceM({ lat: fix.lat, lng: fix.lng }, destination);

  if (remainingDistanceM <= journey.radiusM) {
    return { type: 'alarm' };
  }

  const nextFreqPerMin = interpolatePollFreqPerMin(
    remainingDistanceM,
    journey.initialDistanceM,
    journey.minPollFreqPerMin,
    journey.maxPollFreqPerMin
  );
  const nextIntervalMs = freqPerMinToIntervalMs(nextFreqPerMin);

  const avgSpeedMps = averageSpeedMps(recentFixesForEstimation, fix.recordedAt);
  const eta = estimateEta(remainingDistanceM, journey.radiusM, avgSpeedMps);

  return {
    type: 'continue',
    nextIntervalMs,
    remainingDistanceM,
    avgSpeedMps,
    etaSeconds: eta?.etaSeconds ?? null,
    alarmEtaSeconds: eta?.alarmEtaSeconds ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/location/decideNextAction.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/location/decideNextAction.ts src/location/decideNextAction.test.ts
git commit -m "Add pure radius-check and next-poll-interval decision logic"
```

---

### Task 15: Location — GPS-loss watchdog pure logic

**Files:**
- Create: `src/location/gpsWatchdog.ts`, `src/location/gpsWatchdog.test.ts`

**Interfaces:**
- Consumes: `freqPerMinToIntervalMs` (Task 6), `Journey` (Task 3).
- Produces: `evaluateStaleFix(journey, nowMs): boolean` (pure, tested), `startGpsWatchdog()`, `stopGpsWatchdog()` (glue, device-tested). Covers **Review Focus** item on GPS-loss alerting.

- [ ] **Step 1: Write the failing test**

```ts
// src/location/gpsWatchdog.test.ts
import { evaluateStaleFix } from './gpsWatchdog';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: 100_000, status: 'active',
  createdAt: 0, completedAt: null,
};

test('no fix yet is not treated as stale (nothing to compare against)', () => {
  expect(evaluateStaleFix({ ...baseJourney, lastFixAt: null }, 200_000)).toBe(false);
});

test('a recent fix is not stale', () => {
  // min freq 5/min -> 12s interval; +2min grace = 132s threshold
  expect(evaluateStaleFix(baseJourney, 100_000 + 60_000)).toBe(false);
});

test('a fix older than interval + grace period is stale', () => {
  expect(evaluateStaleFix(baseJourney, 100_000 + 132_000 + 1)).toBe(true);
});

test('exactly at the threshold is not yet stale', () => {
  expect(evaluateStaleFix(baseJourney, 100_000 + 132_000)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/location/gpsWatchdog.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/location/gpsWatchdog.ts
import { freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { Journey } from '../types/journey';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney } from '../db/journeysRepo';
import { triggerGpsLossAlert } from '../alarm/alarmManager';

const CHECK_INTERVAL_MS = 30_000;
let watchdogHandle: ReturnType<typeof setInterval> | null = null;

export function evaluateStaleFix(journey: Journey, nowMs: number): boolean {
  if (journey.lastFixAt === null) return false;
  const currentIntervalMs = freqPerMinToIntervalMs(journey.minPollFreqPerMin);
  const graceMs = journey.gpsLossGraceMinutes * 60_000;
  return nowMs - journey.lastFixAt > currentIntervalMs + graceMs;
}

export function startGpsWatchdog(): void {
  if (watchdogHandle) return;
  watchdogHandle = setInterval(async () => {
    const db = await getDb();
    const journey = await getActiveJourney(db);
    if (journey && evaluateStaleFix(journey, Date.now())) {
      await triggerGpsLossAlert(journey);
    }
  }, CHECK_INTERVAL_MS);
}

export function stopGpsWatchdog(): void {
  if (watchdogHandle) {
    clearInterval(watchdogHandle);
    watchdogHandle = null;
  }
}
```

Note: `startGpsWatchdog`/`stopGpsWatchdog` are glue around `setInterval` and the DB/alarm modules — not unit tested here (would just be re-testing mocks); verify manually per Task 17's device-test steps (e.g. enable airplane mode mid-journey and confirm the GPS-loss alarm fires after the grace period).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/location/gpsWatchdog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/location/gpsWatchdog.ts src/location/gpsWatchdog.test.ts
git commit -m "Add GPS-loss staleness check and watchdog"
```

---

### Task 16: Alarm — channel + alarm manager

**Files:**
- Create: `src/alarm/alarmChannel.ts`, `src/alarm/alarmManager.ts`, `src/alarm/alarmManager.test.ts`

**Interfaces:**
- Produces: `ALARM_CHANNEL_ID`, `ensureAlarmChannel()`, `triggerAlarm(journey)`, `triggerGpsLossAlert(journey)`, `triggerLowBatteryAlert(journey)`. Used by Tasks 15, 17, 27.

- [ ] **Step 1: Write the failing test**

```ts
// src/alarm/alarmManager.test.ts
import notifee from '@notifee/react-native';
import { triggerAlarm, triggerGpsLossAlert, triggerLowBatteryAlert } from './alarmManager';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
}));

const journey: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null,
};

beforeEach(() => jest.clearAllMocks());

test('triggerAlarm displays a full-screen, DND-bypassing ALARM-category notification', async () => {
  await triggerAlarm(journey);
  expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({ bypassDnd: true }));
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      android: expect.objectContaining({
        category: 'alarm',
        fullScreenAction: { id: 'default' },
        loopSound: true,
      }),
    })
  );
});

test('triggerGpsLossAlert displays a full-screen alert with GPS-loss messaging', async () => {
  await triggerGpsLossAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Lost GPS signal' })
  );
});

test('triggerLowBatteryAlert displays a full-screen alert with low-battery messaging', async () => {
  await triggerLowBatteryAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Battery running low' })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/alarm/alarmManager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/alarm/alarmChannel.ts
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

export const ALARM_CHANNEL_ID = 'caller-man-alarm';

export async function ensureAlarmChannel(): Promise<void> {
  await notifee.createChannel({
    id: ALARM_CHANNEL_ID,
    name: 'Journey alarm',
    importance: AndroidImportance.HIGH,
    bypassDnd: true,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'default',
  });
}
```

```ts
// src/alarm/alarmManager.ts
import notifee, { AndroidCategory, AndroidImportance } from '@notifee/react-native';
import { Journey } from '../types/journey';
import { ALARM_CHANNEL_ID, ensureAlarmChannel } from './alarmChannel';

export async function triggerAlarm(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: "You've arrived",
    body: `You're within ${journey.radiusM}m of ${journey.name}`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
      loopSound: true,
      pressAction: { id: 'default' },
      actions: [
        { title: 'Snooze', pressAction: { id: 'snooze' } },
        { title: 'Dismiss', pressAction: { id: 'dismiss' } },
      ],
    },
  });
}

export async function triggerGpsLossAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: 'Lost GPS signal',
    body: `Caller Man hasn't gotten a location fix for ${journey.name} in a while.`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
    },
  });
}

export async function triggerLowBatteryAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: 'Battery running low',
    body: `Battery has reached the cutoff you set for ${journey.name}.`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/alarm/alarmManager.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/alarm/alarmChannel.ts src/alarm/alarmManager.ts src/alarm/alarmManager.test.ts
git commit -m "Add notifee alarm channel and alarm/gps-loss/low-battery triggers"
```

---

### Task 17: Location — background task + location service glue

**Files:**
- Create: `src/location/taskName.ts`, `src/location/backgroundTask.ts`, `src/location/locationService.ts`

**Interfaces:**
- Consumes: `decideNextAction` (14), `evaluateStaleFix`/`startGpsWatchdog`/`stopGpsWatchdog` (15), `triggerAlarm`/`triggerLowBatteryAlert` (16), `getDb` (10), `getActiveJourney`/`updateLastFixAt`/`getJourneyById` (11), `insertFix`/`getRecentFixes` (13), `freqPerMinToIntervalMs` (6).
- Produces: `LOCATION_TASK_NAME`, `requestPermissions()`, `startTracking(journey)`, `stopTracking()` — used by Tasks 25, 26, 27.

This task is native-runtime glue (`TaskManager.defineTask`, `expo-location`, `expo-battery`) that cannot run under Jest/`jest-expo`'s mocked native modules in any way that proves real background behavior — its correctness was already locked in by Task 14/15's pure-logic tests. Verification here is manual, on a real Android device/emulator with location + background permissions granted.

- [ ] **Step 1: Write the task name constant**

```ts
// src/location/taskName.ts
export const LOCATION_TASK_NAME = 'caller-man-location-task';
```

- [ ] **Step 2: Write the background task**

```ts
// src/location/backgroundTask.ts
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from './taskName';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney, updateLastFixAt } from '../db/journeysRepo';
import { insertFix, getRecentFixes } from '../db/locationLogRepo';
import { decideNextAction } from './decideNextAction';
import { triggerAlarm } from '../alarm/alarmManager';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Location task error', error);
    return;
  }
  const { locations } = data as { locations: Location.LocationObject[] };
  const latest = locations[locations.length - 1];
  if (!latest) return;

  const db = await getDb();
  const journey = await getActiveJourney(db);
  if (!journey) return;

  const fix = {
    lat: latest.coords.latitude,
    lng: latest.coords.longitude,
    speedMps: latest.coords.speed ?? null,
    accuracyM: latest.coords.accuracy ?? null,
    recordedAt: latest.timestamp,
  };
  await insertFix(db, journey.id, fix.lat, fix.lng, fix.speedMps, fix.accuracyM, fix.recordedAt);
  await updateLastFixAt(db, journey.id, fix.recordedAt);

  const recent = await getRecentFixes(db, journey.id, fix.recordedAt - 3 * 60 * 1000);
  const action = decideNextAction(journey, fix, recent);

  if (action.type === 'alarm') {
    await triggerAlarm(journey);
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: action.nextIntervalMs,
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: `Heading to ${journey.name}`,
    },
    pausesUpdatesAutomatically: false,
  });
});
```

- [ ] **Step 3: Write the location service**

```ts
// src/location/locationService.ts
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Journey } from '../types/journey';
import { LOCATION_TASK_NAME } from './taskName';
import './backgroundTask'; // registers the task as a side effect
import { startGpsWatchdog, stopGpsWatchdog } from './gpsWatchdog';
import { triggerLowBatteryAlert } from '../alarm/alarmManager';
import { freqPerMinToIntervalMs } from '../geo/pollFrequency';

let batterySubscription: { remove: () => void } | null = null;

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted;
}

export async function startTracking(journey: Journey): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: freqPerMinToIntervalMs(journey.minPollFreqPerMin),
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: `Heading to ${journey.name}`,
    },
    pausesUpdatesAutomatically: false,
  });

  startGpsWatchdog();

  batterySubscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
    const pct = Math.round(batteryLevel * 100);
    if (pct <= journey.batteryCutoffPct) {
      triggerLowBatteryAlert(journey);
    }
  });
}

export async function stopTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  stopGpsWatchdog();
  batterySubscription?.remove();
  batterySubscription = null;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual device verification**

Run: `npx expo run:android` on a physical device (background location behavior is unreliable on emulators).

1. Grant all permissions from the Welcome screen (built in Task 21).
2. Start a journey (once Task 25 exists) with a nearby destination and a short min-poll interval.
3. Background the app (press Home). Confirm the persistent "Caller Man — tracking active" notification appears.
4. Walk/drive toward the destination; confirm the app is brought to the foreground with the full-screen alarm once within the radius.
5. Enable airplane mode mid-journey; confirm a "Lost GPS signal" alert fires after `interval + grace period`.
6. Note results in the task's commit message or a follow-up issue if any step fails — do not mark this task's manual verification done without actually running it on a device.

- [ ] **Step 6: Commit**

```bash
git add src/location/taskName.ts src/location/backgroundTask.ts src/location/locationService.ts
git commit -m "Add background location task and location service (device-verified)"
```

---

### Task 18: Navigation — types, RootNavigator, resolveInitialRoute, App entry

**Files:**
- Create: `src/navigation/types.ts`, `src/navigation/resolveInitialRoute.ts`, `src/navigation/resolveInitialRoute.test.ts`, `src/navigation/RootNavigator.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `runMigrations` (10), `getActiveJourney` (11), all screens (Tasks 21–27, created as stubs here and filled in by their own tasks).
- Produces: `RootStackParamList`, `resolveInitialRoute(activeJourney): 'Journeys' | 'CurrentJourney'`, `RootNavigator`, wired `App.tsx`.

- [ ] **Step 1: Write the failing test for the pure routing decision**

```ts
// src/navigation/resolveInitialRoute.test.ts
import { resolveInitialRoute } from './resolveInitialRoute';
import { Journey } from '../types/journey';

const activeJourney = { status: 'active' } as Journey;

test('routes to CurrentJourney when a journey is active', () => {
  expect(resolveInitialRoute(activeJourney)).toBe('CurrentJourney');
});

test('routes to Journeys when none is active', () => {
  expect(resolveInitialRoute(null)).toBe('Journeys');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/navigation/resolveInitialRoute.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `resolveInitialRoute` and the types**

```ts
// src/navigation/types.ts
export type RootStackParamList = {
  Welcome: undefined;
  Journeys: undefined;
  NewJourney: undefined;
  DefaultSettings: undefined;
  About: undefined;
  CurrentJourney: { journeyId: number };
  Alarm: { journeyId: number; kind: 'arrival' | 'gpsLoss' | 'lowBattery' };
};
```

```ts
// src/navigation/resolveInitialRoute.ts
import { Journey } from '../types/journey';

export function resolveInitialRoute(activeJourney: Journey | null): 'Journeys' | 'CurrentJourney' {
  return activeJourney ? 'CurrentJourney' : 'Journeys';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/navigation/resolveInitialRoute.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `RootNavigator` (screens are created by later tasks; stub them minimally here so this compiles)**

```tsx
// src/navigation/RootNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { JourneysScreen } from '../screens/JourneysScreen';
import { NewJourneyScreen } from '../screens/NewJourneyScreen';
import { DefaultSettingsScreen } from '../screens/DefaultSettingsScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { CurrentJourneyScreen } from '../screens/CurrentJourneyScreen';
import { AlarmScreen } from '../screens/AlarmScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ initialRouteName }: { initialRouteName: keyof RootStackParamList }) {
  return (
    <Stack.Navigator initialRouteName={initialRouteName}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Journeys" component={JourneysScreen} options={{ title: 'Journeys' }} />
      <Stack.Screen name="NewJourney" component={NewJourneyScreen} options={{ title: 'New Journey', presentation: 'modal' }} />
      <Stack.Screen name="DefaultSettings" component={DefaultSettingsScreen} options={{ title: 'Default Settings' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      <Stack.Screen name="CurrentJourney" component={CurrentJourneyScreen} options={{ title: 'Current Journey' }} />
      <Stack.Screen name="Alarm" component={AlarmScreen} options={{ headerShown: false, presentation: 'fullScreenModal' }} />
    </Stack.Navigator>
  );
}
```

Note: this file references all seven screens by their final import paths even though Tasks 21–27 haven't created them yet — implement Tasks 19–27 immediately after this one so the project compiles again. (If executing via `subagent-driven-development`, sequence Tasks 18 → 19 → 20 → 21…27 without merging in between, or create trivial placeholder-exporting files first; either way, no task here ships with a literal `TODO` component.)

- [ ] **Step 6: Write `App.tsx`**

```tsx
// App.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import notifee, { EventType } from '@notifee/react-native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { resolveInitialRoute } from './src/navigation/resolveInitialRoute';
import { getDb } from './src/db/expoSqliteClient';
import { runMigrations } from './src/db/migrations';
import { getActiveJourney } from './src/db/journeysRepo';
import { RootStackParamList } from './src/navigation/types';

export default function App() {
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      await runMigrations(db);
      const active = await getActiveJourney(db);
      setInitialRoute(resolveInitialRoute(active));
    })();

    return notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'dismiss') {
        notifee.cancelNotification(detail.notification?.id ?? '');
      }
    });
  }, []);

  if (initialRoute === null) {
    return null;
  }

  return (
    <NavigationContainer>
      <RootNavigator initialRouteName={initialRoute} />
    </NavigationContainer>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/navigation/types.ts src/navigation/resolveInitialRoute.ts src/navigation/resolveInitialRoute.test.ts src/navigation/RootNavigator.tsx App.tsx
git commit -m "Add navigation shell, cold-start routing, and app entry"
```

---

### Task 19: Reusable SliderWithCustomInput component

**Files:**
- Create: `src/components/SliderWithCustomInput.tsx`, `src/components/SliderWithCustomInput.test.tsx`

**Interfaces:**
- Produces: `<SliderWithCustomInput label unit value min max step? onChange />` — used by Tasks 23 and 25.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/SliderWithCustomInput.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { SliderWithCustomInput } from './SliderWithCustomInput';

test('toggling Custom reveals a text input pre-filled with the current value', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  expect(getByDisplayValue('10')).toBeTruthy();
});

test('entering a valid custom number calls onChange', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  fireEvent.changeText(getByDisplayValue('10'), '75');
  expect(onChange).toHaveBeenCalledWith(75);
});

test('non-numeric custom input does not call onChange', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  fireEvent.changeText(getByDisplayValue('10'), 'abc');
  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/SliderWithCustomInput.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/components/SliderWithCustomInput.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Switch, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';

interface Props {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

export function SliderWithCustomInput({ label, unit, value, min, max, step = 1, onChange }: Props) {
  const [useCustom, setUseCustom] = useState(false);
  const [customText, setCustomText] = useState(String(value));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.customToggle}>
          <Text style={styles.customLabel}>Custom</Text>
          <Switch value={useCustom} onValueChange={setUseCustom} />
        </View>
      </View>

      {useCustom ? (
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={customText}
          onChangeText={(text) => {
            setCustomText(text);
            const parsed = Number(text);
            if (Number.isFinite(parsed) && parsed > 0) {
              onChange(parsed);
            }
          }}
        />
      ) : (
        <>
          <Slider minimumValue={min} maximumValue={max} step={step} value={value} onValueChange={onChange} />
          <Text style={styles.value}>{value} {unit}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
  customToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customLabel: { fontSize: 12, color: '#9ca3af' },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff' },
  value: { fontSize: 12, textAlign: 'right', color: '#9ca3af' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/SliderWithCustomInput.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/SliderWithCustomInput.tsx src/components/SliderWithCustomInput.test.tsx
git commit -m "Add reusable slider-with-custom-input component"
```

---

### Task 20: JourneyCard component

**Files:**
- Create: `src/components/JourneyCard.tsx`, `src/components/JourneyCard.test.tsx`

**Interfaces:**
- Consumes: `Journey` (Task 3).
- Produces: `<JourneyCard journey onPress />` — used by Task 24.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/JourneyCard.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { JourneyCard } from './JourneyCard';
import { Journey } from '../types/journey';

const journey: Journey = {
  id: 1, name: 'Train Station', destinationLat: 0, destinationLng: 0, radiusM: 1000,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping', batteryCutoffPct: 15,
  snoozeMinutes: 3, gpsLossGraceMinutes: 2, initialDistanceM: 5000, lastFixAt: null,
  status: 'active', createdAt: Date.now(), completedAt: null,
};

test('renders the journey name and status', () => {
  const { getByText } = render(<JourneyCard journey={journey} onPress={jest.fn()} />);
  expect(getByText('Train Station')).toBeTruthy();
  expect(getByText('active')).toBeTruthy();
});

test('pressing the card calls onPress with the journey', () => {
  const onPress = jest.fn();
  const { getByText } = render(<JourneyCard journey={journey} onPress={onPress} />);
  fireEvent.press(getByText('Train Station'));
  expect(onPress).toHaveBeenCalledWith(journey);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/JourneyCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/components/JourneyCard.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Journey } from '../types/journey';

interface Props {
  journey: Journey;
  onPress: (journey: Journey) => void;
}

export function JourneyCard({ journey, onPress }: Props) {
  return (
    <Pressable style={styles.card} onPress={() => onPress(journey)}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{journey.name}</Text>
        <Text style={styles.status}>{journey.status}</Text>
      </View>
      <Text style={styles.meta}>
        Radius {(journey.radiusM / 1000).toFixed(1)} km · {new Date(journey.createdAt).toLocaleDateString()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 10, backgroundColor: '#111827', marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  status: { color: '#34d399', fontSize: 12, textTransform: 'uppercase' },
  meta: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/JourneyCard.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/JourneyCard.tsx src/components/JourneyCard.test.tsx
git commit -m "Add JourneyCard component"
```

---

### Task 21: Welcome/Permissions screen

**Files:**
- Create: `src/screens/WelcomeScreen.tsx`, `src/screens/WelcomeScreen.test.tsx`

**Interfaces:**
- Consumes: `RootStackParamList` (18).
- Produces: `<WelcomeScreen navigation route />` — the `Welcome` route in `RootNavigator`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/WelcomeScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';
import { WelcomeScreen } from './WelcomeScreen';

jest.mock('expo-location');
jest.mock('expo-notifications');
jest.mock('@notifee/react-native', () => ({ requestPermission: jest.fn() }));

const navigation = { replace: jest.fn() } as any;

beforeEach(() => jest.clearAllMocks());

test('does not navigate when GPS permission is denied', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('navigates to Journeys once GPS and background permission are granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/WelcomeScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/WelcomeScreen.tsx
import React, { useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const PERMISSION_ITEMS = [
  { key: 'gps', label: 'GPS Location Access' },
  { key: 'background', label: 'Wake Up in Background' },
  { key: 'toggleGps', label: 'Toggle GPS On/Off' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'overlay', label: 'Display Over Other Apps' },
  { key: 'dnd', label: 'Bypass Silent Mode & DND' },
] as const;

type PermissionKey = (typeof PERMISSION_ITEMS)[number]['key'];

export function WelcomeScreen({ navigation }: Props) {
  const [granted, setGranted] = useState<Record<PermissionKey, boolean>>({
    gps: false, background: false, toggleGps: false, notifications: false, overlay: false, dnd: false,
  });

  async function requestAll() {
    const fg = await Location.requestForegroundPermissionsAsync();
    const bg = await Location.requestBackgroundPermissionsAsync();
    const notif = await Notifications.requestPermissionsAsync();
    const settings = await notifee.requestPermission();

    const next: Record<PermissionKey, boolean> = {
      gps: fg.granted,
      background: bg.granted,
      toggleGps: fg.granted,
      notifications: notif.granted,
      overlay: true,
      dnd: settings.authorizationStatus >= 1,
    };
    setGranted(next);

    if (!next.gps || !next.background) {
      return;
    }
    navigation.replace('Journeys');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Caller Man</Text>
      <Text style={styles.subtitle}>GPS proximity alarm for your destinations</Text>

      {PERMISSION_ITEMS.map((item) => (
        <View key={item.key} style={styles.row}>
          <Text style={styles.rowLabel}>{item.label}</Text>
          <Switch value={granted[item.key]} disabled />
        </View>
      ))}

      <Pressable style={styles.button} onPress={requestAll}>
        <Text style={styles.buttonText}>Grant All Permissions to Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#0b0f1a', flexGrow: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 40 },
  subtitle: { color: '#9ca3af', textAlign: 'center', marginBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  rowLabel: { color: '#e5e7eb' },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 24 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/WelcomeScreen.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/WelcomeScreen.tsx src/screens/WelcomeScreen.test.tsx
git commit -m "Add Welcome/Permissions screen with hard-requirement gating"
```

---

### Task 22: About screen

**Files:**
- Create: `src/screens/AboutScreen.tsx`, `src/screens/AboutScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/AboutScreen.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from './AboutScreen';

test('renders the app name and version', () => {
  const { getByText } = render(<AboutScreen />);
  expect(getByText('Caller Man')).toBeTruthy();
  expect(getByText('v1.0.0')).toBeTruthy();
});

test('tapping the donate link opens the donation URL', () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue();
  const { getByText } = render(<AboutScreen />);
  fireEvent.press(getByText('Consider donating'));
  expect(openURL).toHaveBeenCalledWith(expect.stringContaining('http'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/AboutScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/AboutScreen.tsx
import React from 'react';
import { View, Text, Linking, Pressable, StyleSheet } from 'react-native';

const DONATION_URL = 'https://example.com/donate';

export function AboutScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Caller Man</Text>
      <Text style={styles.version}>v1.0.0</Text>
      <Text style={styles.body}>
        This is an app built as part of a designing journey. I hope you like it.
      </Text>
      <Pressable onPress={() => Linking.openURL(DONATION_URL)}>
        <Text style={styles.link}>Consider donating</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  version: { color: '#9ca3af', marginBottom: 16 },
  body: { color: '#e5e7eb', marginBottom: 16, lineHeight: 20 },
  link: { color: '#34d399', fontWeight: '600' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/AboutScreen.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/AboutScreen.tsx src/screens/AboutScreen.test.tsx
git commit -m "Add About screen"
```

---

### Task 23: Default Settings screen

**Files:**
- Create: `src/screens/DefaultSettingsScreen.tsx`, `src/screens/DefaultSettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `getDefaultSettings`/`saveDefaultSettings` (12), `SliderWithCustomInput` (19), `reconcileMinMaxFreq` (7), limit constants (3).

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/DefaultSettingsScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { DefaultSettingsScreen } from './DefaultSettingsScreen';
import { getDefaultSettings, saveDefaultSettings } from '../db/settingsRepo';

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/settingsRepo');

const baseSettings = {
  radiusM: 10000, maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...baseSettings });
  (saveDefaultSettings as jest.Mock).mockResolvedValue(undefined);
});

test('saving persists the loaded settings via the repository', async () => {
  const { getByText, findByText } = render(<DefaultSettingsScreen />);
  await findByText('Save');
  fireEvent.press(getByText('Save'));
  await waitFor(() =>
    expect(saveDefaultSettings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(baseSettings))
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/DefaultSettingsScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/DefaultSettingsScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { getDb } from '../db/expoSqliteClient';
import { getDefaultSettings, saveDefaultSettings } from '../db/settingsRepo';
import { DefaultSettings } from '../types/journey';
import { SliderWithCustomInput } from '../components/SliderWithCustomInput';
import { reconcileMinMaxFreq } from '../geo/pollFreqOrdering';
import {
  RADIUS_MIN_M, RADIUS_MAX_M, POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN,
  SNOOZE_MINUTES_MIN, SNOOZE_MINUTES_MAX, GPS_LOSS_GRACE_MINUTES_MIN, GPS_LOSS_GRACE_MINUTES_MAX,
} from '../constants/limits';

export function DefaultSettingsScreen() {
  const [settings, setSettings] = useState<DefaultSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      setSettings(await getDefaultSettings(db));
    })();
  }, []);

  if (!settings) return null;

  function updateFreq(changed: 'min' | 'max', value: number) {
    const reconciled = reconcileMinMaxFreq(
      changed,
      changed === 'min' ? value : settings!.minPollFreqPerMin,
      changed === 'max' ? value : settings!.maxPollFreqPerMin
    );
    setSettings({ ...settings!, minPollFreqPerMin: reconciled.minFreqPerMin, maxPollFreqPerMin: reconciled.maxFreqPerMin });
    setSaved(false);
  }

  async function handleSave() {
    const db = await getDb();
    await saveDefaultSettings(db, settings);
    setSaved(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SliderWithCustomInput label="Alarm Radius" unit="km" value={settings.radiusM / 1000}
        min={RADIUS_MIN_M / 1000} max={RADIUS_MAX_M / 1000}
        onChange={(v) => { setSettings({ ...settings, radiusM: v * 1000 }); setSaved(false); }} />
      <SliderWithCustomInput label="Max GPS Poll Frequency" unit="/m" value={settings.maxPollFreqPerMin}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => updateFreq('max', v)} />
      <SliderWithCustomInput label="Min GPS Poll Frequency" unit="/m" value={settings.minPollFreqPerMin}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => updateFreq('min', v)} />
      <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={settings.batteryCutoffPct}
        min={5} max={50} onChange={(v) => { setSettings({ ...settings, batteryCutoffPct: v }); setSaved(false); }} />
      <SliderWithCustomInput label="Snooze Duration" unit="min" value={settings.snoozeMinutes}
        min={SNOOZE_MINUTES_MIN} max={SNOOZE_MINUTES_MAX}
        onChange={(v) => { setSettings({ ...settings, snoozeMinutes: v }); setSaved(false); }} />
      <SliderWithCustomInput label="GPS Loss Grace Period" unit="min" value={settings.gpsLossGraceMinutes}
        min={GPS_LOSS_GRACE_MINUTES_MIN} max={GPS_LOSS_GRACE_MINUTES_MAX}
        onChange={(v) => { setSettings({ ...settings, gpsLossGraceMinutes: v }); setSaved(false); }} />
      <View style={styles.field}>
        <Text style={styles.label}>Alarm Tune</Text>
        <TextInput style={styles.input} value={settings.alarmTune}
          onChangeText={(v) => { setSettings({ ...settings, alarmTune: v }); setSaved(false); }} />
      </View>
      <Pressable style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>{saved ? 'Defaults Saved' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0b0f1a', flexGrow: 1 },
  field: { marginVertical: 12 },
  label: { color: '#e5e7eb', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff' },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 12 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/DefaultSettingsScreen.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/screens/DefaultSettingsScreen.tsx src/screens/DefaultSettingsScreen.test.tsx
git commit -m "Add Default Settings screen, incl. configurable snooze and GPS-loss grace period"
```

---

### Task 24: Journeys (home) screen

**Files:**
- Create: `src/screens/JourneysScreen.tsx`, `src/screens/JourneysScreen.test.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `listJourneys` (11), `JourneyCard` (20).

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/JourneysScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { JourneysScreen } from './JourneysScreen';
import { listJourneys } from '../db/journeysRepo';

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

const activeJourney = { id: 1, name: 'Train Station', status: 'active', radiusM: 1000, createdAt: Date.now() };
const completedJourney = { id: 2, name: 'Airport', status: 'completed', radiusM: 500, createdAt: Date.now() - 1000 };

beforeEach(() => {
  jest.clearAllMocks();
  (listJourneys as jest.Mock).mockResolvedValue([activeJourney, completedJourney]);
});

test('lists journeys from the repository', async () => {
  const { findByText } = render(<JourneysScreen navigation={{} as any} route={{} as any} />);
  expect(await findByText('Train Station')).toBeTruthy();
  expect(await findByText('Airport')).toBeTruthy();
});

test('tapping the active journey navigates to CurrentJourney', async () => {
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Train Station');
  fireEvent.press(getByText('Train Station'));
  expect(navigation.navigate).toHaveBeenCalledWith('CurrentJourney', { journeyId: 1 });
});

test('tapping a completed journey does not navigate', async () => {
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Airport');
  fireEvent.press(getByText('Airport'));
  expect(navigation.navigate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/JourneysScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/JourneysScreen.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { listJourneys } from '../db/journeysRepo';
import { Journey } from '../types/journey';
import { JourneyCard } from '../components/JourneyCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Journeys'>;

export function JourneysScreen({ navigation }: Props) {
  const [journeys, setJourneys] = useState<Journey[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const db = await getDb();
        setJourneys(await listJourneys(db));
      })();
    }, [])
  );

  function handleCardPress(journey: Journey) {
    if (journey.status === 'active') {
      navigation.navigate('CurrentJourney', { journeyId: journey.id });
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={journeys}
        keyExtractor={(j) => String(j.id)}
        renderItem={({ item }) => <JourneyCard journey={item} onPress={handleCardPress} />}
        ListEmptyComponent={<Text style={styles.empty}>No journeys yet</Text>}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewJourney')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a', padding: 16 },
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  fabText: { color: '#04140d', fontSize: 28, fontWeight: '700' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/JourneysScreen.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/JourneysScreen.tsx src/screens/JourneysScreen.test.tsx
git commit -m "Add Journeys home screen"
```

---

### Task 25: New Journey setup screen

**Files:**
- Create: `src/screens/NewJourneyScreen.tsx`, `src/screens/NewJourneyScreen.test.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `getDefaultSettings` (12), `createJourney`/`ActiveJourneyExistsError` (11), `SliderWithCustomInput` (19), `haversineDistanceM` (4), `clampRadiusToCap` (5), `reconcileMinMaxFreq` (7), `maxAllowedBatteryCutoffPct` (8), `startTracking` (17), limit constants (3).

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/NewJourneyScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NewJourneyScreen } from './NewJourneyScreen';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError } from '../db/journeysRepo';
import { startTracking } from '../location/locationService';

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/settingsRepo');
jest.mock('../db/journeysRepo');
jest.mock('../location/locationService');
jest.mock('expo-battery', () => ({ getBatteryLevelAsync: jest.fn().mockResolvedValue(1) }));
jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapboxMapView',
  Camera: 'MapboxCamera',
  PointAnnotation: 'MapboxPointAnnotation',
}));

const defaults = {
  radiusM: 10000, maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...defaults });
});

test('shows an alert and does not navigate when a journey is already active', async () => {
  (createJourney as jest.Mock).mockRejectedValue(new ActiveJourneyExistsError());
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey');
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(createJourney).toHaveBeenCalled());
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(startTracking).not.toHaveBeenCalled();
});

test('starting a journey creates it, starts tracking, and navigates to CurrentJourney', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 42, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey');
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('CurrentJourney', { journeyId: 42 }));
  expect(startTracking).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/NewJourneyScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/NewJourneyScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import * as Battery from 'expo-battery';
import Mapbox from '@rnmapbox/maps';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError } from '../db/journeysRepo';
import { DefaultSettings } from '../types/journey';
import { SliderWithCustomInput } from '../components/SliderWithCustomInput';
import { haversineDistanceM } from '../geo/haversine';
import { clampRadiusToCap } from '../geo/radiusCap';
import { reconcileMinMaxFreq } from '../geo/pollFreqOrdering';
import { maxAllowedBatteryCutoffPct } from '../geo/batteryCutoff';
import { startTracking } from '../location/locationService';
import { RADIUS_MIN_M, RADIUS_MAX_M, POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';

type Props = NativeStackScreenProps<RootStackParamList, 'NewJourney'>;

export function NewJourneyScreen({ navigation }: Props) {
  const [defaults, setDefaults] = useState<DefaultSettings | null>(null);
  const [name, setName] = useState('New Journey');
  const [destLat, setDestLat] = useState(51.5074);
  const [destLng, setDestLng] = useState(-0.1278);
  const [userLat] = useState(51.5074);
  const [userLng] = useState(-0.1278);
  const [radiusM, setRadiusM] = useState(0);
  const [maxFreq, setMaxFreq] = useState(0);
  const [minFreq, setMinFreq] = useState(0);
  const [batteryCutoff, setBatteryCutoff] = useState(0);
  const [currentBatteryPct, setCurrentBatteryPct] = useState(100);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const d = await getDefaultSettings(db);
      setDefaults(d);
      setRadiusM(d.radiusM);
      setMaxFreq(d.maxPollFreqPerMin);
      setMinFreq(d.minPollFreqPerMin);

      const level = await Battery.getBatteryLevelAsync();
      const pct = Math.round(level * 100);
      setCurrentBatteryPct(pct);
      setBatteryCutoff(Math.min(d.batteryCutoffPct, maxAllowedBatteryCutoffPct(pct, d.batteryCutoffPct)));
    })();
  }, []);

  const distanceM = haversineDistanceM({ lat: userLat, lng: userLng }, { lat: destLat, lng: destLng });
  const radiusCapM = distanceM * 0.4;

  function handleDestinationChange(lat: number, lng: number) {
    setDestLat(lat);
    setDestLng(lng);
    const newDistance = haversineDistanceM({ lat: userLat, lng: userLng }, { lat, lng });
    setRadiusM((current) => clampRadiusToCap(current, newDistance));
  }

  function handleRadiusChange(km: number) {
    setRadiusM(clampRadiusToCap(km * 1000, distanceM));
  }

  function handleFreqChange(changed: 'min' | 'max', value: number) {
    const reconciled = reconcileMinMaxFreq(
      changed,
      changed === 'min' ? value : minFreq,
      changed === 'max' ? value : maxFreq
    );
    setMinFreq(reconciled.minFreqPerMin);
    setMaxFreq(reconciled.maxFreqPerMin);
  }

  async function handleStart() {
    if (!defaults) return;
    try {
      const db = await getDb();
      const journey = await createJourney(db, {
        name,
        destinationLat: destLat,
        destinationLng: destLng,
        radiusM,
        maxPollFreqPerMin: maxFreq,
        minPollFreqPerMin: minFreq,
        alarmTune: defaults.alarmTune,
        batteryCutoffPct: batteryCutoff,
        snoozeMinutes: defaults.snoozeMinutes,
        gpsLossGraceMinutes: defaults.gpsLossGraceMinutes,
        initialDistanceM: distanceM,
      });
      await startTracking(journey);
      navigation.replace('CurrentJourney', { journeyId: journey.id });
    } catch (err) {
      if (err instanceof ActiveJourneyExistsError) {
        Alert.alert('Journey already active', 'Finish or cancel your current journey first.');
        return;
      }
      throw err;
    }
  }

  if (!defaults) return null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Journey Name" placeholderTextColor="#6b7280" />

      <Mapbox.MapView
        style={styles.map}
        onPress={(e: any) => {
          const [lng, lat] = e.geometry.coordinates as [number, number];
          handleDestinationChange(lat, lng);
        }}
      >
        <Mapbox.Camera centerCoordinate={[destLng, destLat]} zoomLevel={10} />
        <Mapbox.PointAnnotation id="destination" coordinate={[destLng, destLat]} />
      </Mapbox.MapView>

      <View style={styles.coordRow}>
        <TextInput style={[styles.input, styles.coordInput]} keyboardType="numeric" value={String(destLat)}
          onChangeText={(t) => handleDestinationChange(Number(t) || 0, destLng)} />
        <TextInput style={[styles.input, styles.coordInput]} keyboardType="numeric" value={String(destLng)}
          onChangeText={(t) => handleDestinationChange(destLat, Number(t) || 0)} />
      </View>

      <SliderWithCustomInput label="Alarm Radius" unit="km" value={radiusM / 1000}
        min={RADIUS_MIN_M / 1000} max={Math.min(RADIUS_MAX_M / 1000, radiusCapM / 1000)}
        onChange={handleRadiusChange} />
      <SliderWithCustomInput label="Max GPS Poll Frequency" unit="/m" value={maxFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('max', v)} />
      <SliderWithCustomInput label="Min GPS Poll Frequency" unit="/m" value={minFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('min', v)} />
      <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={batteryCutoff}
        min={0} max={maxAllowedBatteryCutoffPct(currentBatteryPct, defaults.batteryCutoffPct)} onChange={setBatteryCutoff} />

      <Pressable style={styles.button} onPress={handleStart}>
        <Text style={styles.buttonText}>Start Journey</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0b0f1a', flexGrow: 1 },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff', marginBottom: 12 },
  map: { height: 220, borderRadius: 10, marginBottom: 12 },
  coordRow: { flexDirection: 'row', gap: 10 },
  coordInput: { flex: 1 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 16 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
```

Note: destination search-by-text (mentioned in spec §5.3) is intentionally left for a fast-follow task once a Mapbox Geocoding API key/flow is chosen — this task delivers drag-pin + manual lat/lng entry, both of which the spec's mockups show as required; search is additive on top of the same `handleDestinationChange` handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/NewJourneyScreen.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/NewJourneyScreen.tsx src/screens/NewJourneyScreen.test.tsx
git commit -m "Add New Journey setup screen with business-rule validation"
```

---

### Task 26: Current Journey screen

**Files:**
- Create: `src/screens/CurrentJourneyScreen.tsx`, `src/screens/CurrentJourneyScreen.test.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `getActiveJourney`/`finishJourney` (11), `getRecentFixes` (13), `haversineDistanceM` (4), `averageSpeedMps`/`estimateEta` (9), `stopTracking` (17).

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/CurrentJourneyScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CurrentJourneyScreen } from './CurrentJourneyScreen';
import { getActiveJourney, finishJourney } from '../db/journeysRepo';
import { getRecentFixes } from '../db/locationLogRepo';
import { stopTracking } from '../location/locationService';

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('../db/locationLogRepo');
jest.mock('../location/locationService');
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void) => cb() }));
jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapboxMapView', Camera: 'MapboxCamera', PointAnnotation: 'MapboxPointAnnotation',
  ShapeSource: 'MapboxShapeSource', CircleLayer: 'MapboxCircleLayer',
}));

const journey = {
  id: 5, name: 'Train Station', destinationLat: 0, destinationLng: 0, radiusM: 1000,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getActiveJourney as jest.Mock).mockResolvedValue(journey);
  (getRecentFixes as jest.Mock).mockResolvedValue([]);
});

test('cancelling the journey marks it cancelled, stops tracking, and navigates home', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey');
  fireEvent.press(getByText('Cancel Journey'));

  await waitFor(() => expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 5, 'cancelled'));
  expect(stopTracking).toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Journeys');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/CurrentJourneyScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/CurrentJourneyScreen.tsx
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney, finishJourney } from '../db/journeysRepo';
import { getRecentFixes } from '../db/locationLogRepo';
import { Journey } from '../types/journey';
import { haversineDistanceM } from '../geo/haversine';
import { averageSpeedMps, estimateEta } from '../geo/estimation';
import { stopTracking } from '../location/locationService';

type Props = NativeStackScreenProps<RootStackParamList, 'CurrentJourney'>;

export function CurrentJourneyScreen({ navigation }: Props) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [remainingM, setRemainingM] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const db = await getDb();
        const active = await getActiveJourney(db);
        if (!active || cancelled) return;
        setJourney(active);

        const recent = await getRecentFixes(db, active.id, Date.now() - 3 * 60 * 1000);
        if (recent.length === 0) return;
        const last = recent[recent.length - 1];
        const distance = haversineDistanceM(last, { lat: active.destinationLat, lng: active.destinationLng });
        setRemainingM(distance);
        const speed = averageSpeedMps(
          recent.map((f) => ({ lat: f.lat, lng: f.lng, recordedAt: f.recordedAt })),
          Date.now()
        );
        const eta = estimateEta(distance, active.radiusM, speed);
        setEtaSeconds(eta?.etaSeconds ?? null);
      })();
      return () => { cancelled = true; };
    }, [])
  );

  async function handleCancel() {
    if (!journey) return;
    Alert.alert('Cancel journey?', 'This will stop tracking.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Cancel journey',
        style: 'destructive',
        onPress: async () => {
          const db = await getDb();
          await finishJourney(db, journey.id, 'cancelled');
          await stopTracking();
          navigation.replace('Journeys');
        },
      },
    ]);
  }

  if (!journey) {
    return <View style={styles.container}><Text style={styles.info}>No active journey</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map}>
        <Mapbox.Camera centerCoordinate={[journey.destinationLng, journey.destinationLat]} zoomLevel={11} />
        <Mapbox.PointAnnotation id="destination" coordinate={[journey.destinationLng, journey.destinationLat]} />
        <Mapbox.ShapeSource
          id="radius-source"
          shape={{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [journey.destinationLng, journey.destinationLat] },
            properties: { radius: journey.radiusM },
          }}
        >
          <Mapbox.CircleLayer id="radius-layer" style={{ circleRadius: journey.radiusM, circleOpacity: 0.15 }} />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <View style={styles.panel}>
        <Text style={styles.destination}>{journey.name}</Text>
        <Text style={styles.info}>Radius: {(journey.radiusM / 1000).toFixed(1)} km</Text>
        <Text style={styles.info}>
          Remaining: {remainingM !== null ? `${(remainingM / 1000).toFixed(1)} km` : 'estimating…'}
        </Text>
        <Text style={styles.info}>
          ETA: {etaSeconds !== null ? `${Math.round(etaSeconds / 60)} min` : 'estimating…'}
        </Text>
        <Pressable style={styles.cancelButton} onPress={handleCancel}>
          <Text style={styles.cancelText}>Cancel Journey</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a' },
  map: { flex: 1 },
  panel: { padding: 20 },
  destination: { color: '#fff', fontSize: 18, fontWeight: '700' },
  info: { color: '#9ca3af', marginTop: 4 },
  cancelButton: { backgroundColor: '#ef4444', padding: 12, borderRadius: 10, marginTop: 16 },
  cancelText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/CurrentJourneyScreen.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/screens/CurrentJourneyScreen.tsx src/screens/CurrentJourneyScreen.test.tsx
git commit -m "Add Current Journey live-tracking screen"
```

---

### Task 27: Alarm-fired screen

**Files:**
- Create: `src/screens/AlarmScreen.tsx`, `src/screens/AlarmScreen.test.tsx`

**Interfaces:**
- Consumes: `getDb` (10), `getJourneyById`/`finishJourney` (11), `stopTracking` (17), `triggerAlarm` (16).

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/AlarmScreen.test.tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AlarmScreen } from './AlarmScreen';
import { getJourneyById, finishJourney } from '../db/journeysRepo';
import { stopTracking } from '../location/locationService';

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('../location/locationService');
jest.mock('@notifee/react-native', () => ({ stopForegroundService: jest.fn() }));

const journey = { id: 7, snoozeMinutes: 3 };

beforeEach(() => {
  jest.clearAllMocks();
  (getJourneyById as jest.Mock).mockResolvedValue(journey);
});

test('dismissing an arrival alarm completes the journey and stops tracking', async () => {
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation} />
  );
  await findByText('Dismiss');
  fireEvent.press(getByText('Dismiss'));

  await waitFor(() => expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 7, 'completed'));
  expect(stopTracking).toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Journeys');
});

test('dismissing a GPS-loss alarm leaves the journey active and returns to Current Journey', async () => {
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'gpsLoss' } } as any} navigation={navigation} />
  );
  await findByText('Dismiss');
  fireEvent.press(getByText('Dismiss'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('CurrentJourney', { journeyId: 7 }));
  expect(finishJourney).not.toHaveBeenCalled();
  expect(stopTracking).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/AlarmScreen.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/screens/AlarmScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import notifee from '@notifee/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getJourneyById, finishJourney } from '../db/journeysRepo';
import { Journey } from '../types/journey';
import { stopTracking } from '../location/locationService';
import { triggerAlarm } from '../alarm/alarmManager';

type Props = NativeStackScreenProps<RootStackParamList, 'Alarm'>;

const TITLES: Record<Props['route']['params']['kind'], string> = {
  arrival: "You've arrived",
  gpsLoss: 'Lost GPS signal',
  lowBattery: 'Battery running low',
};

export function AlarmScreen({ route, navigation }: Props) {
  const { journeyId, kind } = route.params;
  const [journey, setJourney] = useState<Journey | null>(null);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      setJourney(await getJourneyById(db, journeyId));
    })();
  }, [journeyId]);

  async function handleDismiss() {
    await notifee.stopForegroundService();
    if (kind === 'arrival') {
      const db = await getDb();
      await finishJourney(db, journeyId, 'completed');
      await stopTracking();
      navigation.replace('Journeys');
      return;
    }
    navigation.replace('CurrentJourney', { journeyId });
  }

  async function handleSnooze() {
    if (!journey) return;
    await notifee.stopForegroundService();
    setTimeout(() => {
      triggerAlarm(journey);
    }, journey.snoozeMinutes * 60_000);
    navigation.replace('CurrentJourney', { journeyId });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{TITLES[kind]}</Text>
      <Pressable style={styles.snoozeButton} onPress={handleSnooze} disabled={!journey}>
        <Text style={styles.buttonText}>Snooze{journey ? ` ${journey.snoozeMinutes}m` : ''}</Text>
      </Pressable>
      <Pressable style={styles.dismissButton} onPress={handleDismiss}>
        <Text style={styles.buttonText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 40, textAlign: 'center' },
  snoozeButton: { backgroundColor: '#f59e0b', padding: 16, borderRadius: 12, width: '100%', marginBottom: 12 },
  dismissButton: { backgroundColor: '#10b981', padding: 16, borderRadius: 12, width: '100%' },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/AlarmScreen.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Full test suite + type-check**

Run: `npx jest && npx tsc --noEmit`
Expected: all tests across every task pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/AlarmScreen.tsx src/screens/AlarmScreen.test.tsx
git commit -m "Add Alarm-fired screen with snooze/dismiss wiring"
```

---

### Task 28: Mapbox access token + destination search (geocoding)

Self-review caught a spec gap: spec §5.3 requires the destination map picker to support "both searching and pinning location on map," but Task 25 only wired up pin-dragging and manual lat/lng entry. This task and Task 29 close that gap. It also wires up `Mapbox.setAccessToken`, needed by the SDK at runtime regardless of geocoding, which no earlier task did.

**Files:**
- Create: `src/constants/mapbox.ts`, `src/location/geocode.ts`, `src/location/geocode.test.ts`
- Modify: `App.tsx`

**Interfaces:**
- Produces: `MAPBOX_ACCESS_TOKEN`, `GeocodeResult` type, `searchDestination(query, accessToken): Promise<GeocodeResult[]>` — used by Task 29.

- [ ] **Step 1: Write the failing test**

```ts
// src/location/geocode.test.ts
import { searchDestination } from './geocode';

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

test('maps Mapbox geocoding features to lat/lng results', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      features: [{ center: [-0.1278, 51.5074], place_name: 'London, UK' }],
    }),
  });
  const results = await searchDestination('London', 'token');
  expect(results).toEqual([{ lat: 51.5074, lng: -0.1278, placeName: 'London, UK' }]);
});

test('throws with the status code when the request fails', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  await expect(searchDestination('nowhere', 'token')).rejects.toThrow('500');
});

test('returns an empty array when no places match', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
  expect(await searchDestination('asdfghjkl', 'token')).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/location/geocode.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/constants/mapbox.ts
export const MAPBOX_ACCESS_TOKEN = 'REPLACE_WITH_YOUR_MAPBOX_PUBLIC_ACCESS_TOKEN';
```

Note: this is the runtime *public* access token (`pk.…`), a different credential from the *download* token (`sk.…`) already placed in `app.json`'s `@rnmapbox/maps` plugin config in Task 2 — Mapbox issues both from the same account, for different purposes.

```ts
// src/location/geocode.ts
export interface GeocodeResult {
  lat: number;
  lng: number;
  placeName: string;
}

export async function searchDestination(query: string, accessToken: string): Promise<GeocodeResult[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${accessToken}&limit=5`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status}`);
  }
  const data = await response.json();
  return (data.features ?? []).map((f: any) => ({
    lat: f.center[1],
    lng: f.center[0],
    placeName: f.place_name,
  }));
}
```

Add to the top of `App.tsx` (before the `App` function), so the SDK is configured before any map renders:

```tsx
import Mapbox from '@rnmapbox/maps';
import { MAPBOX_ACCESS_TOKEN } from './src/constants/mapbox';

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/location/geocode.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/constants/mapbox.ts src/location/geocode.ts src/location/geocode.test.ts App.tsx
git commit -m "Add Mapbox access token setup and destination geocoding search"
```

---

### Task 29: Wire destination search into the New Journey screen

**Files:**
- Modify: `src/screens/NewJourneyScreen.tsx`, `src/screens/NewJourneyScreen.test.tsx`

**Interfaces:**
- Consumes: `searchDestination` (28), `MAPBOX_ACCESS_TOKEN` (28), `handleDestinationChange` (already in Task 25's `NewJourneyScreen`).

- [ ] **Step 1: Add a failing test for the search flow**

Add to `src/screens/NewJourneyScreen.test.tsx` (alongside the existing two tests, with the existing mocks retained):

```tsx
import { searchDestination } from '../location/geocode';

jest.mock('../location/geocode');

test('searching for a destination moves the pin to the first result', async () => {
  (searchDestination as jest.Mock).mockResolvedValue([
    { lat: 51.4700, lng: -0.4543, placeName: 'Heathrow Terminal 5' },
  ]);
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByPlaceholderText, findByDisplayValue } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByDisplayValue('51.5074'); // initial default latitude has loaded

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'Heathrow');
  fireEvent.press(getByText('Go'));

  await waitFor(() => expect(searchDestination).toHaveBeenCalledWith('Heathrow', expect.any(String)));
  expect(await findByDisplayValue('51.47')).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/NewJourneyScreen.test.tsx`
Expected: FAIL — no "Go" button / no search field exists yet

- [ ] **Step 3: Add the search UI and handler to `NewJourneyScreen`**

Add these imports to the top of `src/screens/NewJourneyScreen.tsx` (alongside the existing ones from Task 25):

```tsx
import { searchDestination } from '../location/geocode';
import { MAPBOX_ACCESS_TOKEN } from '../constants/mapbox';
```

Add this state, alongside the other `useState` calls in the component:

```tsx
const [searchQuery, setSearchQuery] = useState('');
```

Add this handler, alongside `handleDestinationChange`:

```tsx
async function handleSearch() {
  if (!searchQuery.trim()) return;
  const results = await searchDestination(searchQuery, MAPBOX_ACCESS_TOKEN);
  const first = results[0];
  if (first) {
    handleDestinationChange(first.lat, first.lng);
  }
}
```

Add this JSX immediately above the `<Mapbox.MapView ...>` element:

```tsx
<View style={styles.searchRow}>
  <TextInput
    style={[styles.input, styles.searchInput]}
    value={searchQuery}
    onChangeText={setSearchQuery}
    placeholder="e.g. Heathrow Terminal 5"
    placeholderTextColor="#6b7280"
  />
  <Pressable style={styles.goButton} onPress={handleSearch}>
    <Text style={styles.goButtonText}>Go</Text>
  </Pressable>
</View>
```

Add these styles to the `StyleSheet.create` call:

```tsx
searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
searchInput: { flex: 1, marginBottom: 0 },
goButton: { backgroundColor: '#10b981', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 6 },
goButtonText: { color: '#04140d', fontWeight: '700' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/NewJourneyScreen.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/NewJourneyScreen.tsx src/screens/NewJourneyScreen.test.tsx
git commit -m "Add destination search to New Journey screen"
```

---

### Task 30: Offline map caching for the active journey's area

Self-review caught a second spec gap: spec §2 requires the app to "work with no internet connectivity mid-journey (offline map caching for the currently selected route/area)," which no earlier task implemented.

**Files:**
- Create: `src/location/offlineMapCache.ts`, `src/location/offlineMapCache.test.ts`
- Modify: `src/screens/NewJourneyScreen.tsx` (cache the area when a journey starts), `src/screens/CurrentJourneyScreen.tsx` (evict the cache on cancel), `src/screens/AlarmScreen.tsx` (evict the cache on arrival dismiss)

**Interfaces:**
- Consumes: `Journey` (Task 3).
- Produces: `packNameForJourney(journeyId): string`, `computeBounds(userLat, userLng, destLat, destLng): [[number, number], [number, number]]`, `cacheAreaForJourney(journey, userLat, userLng): Promise<void>`, `removeAreaCacheForJourney(journeyId): Promise<void>`.

- [ ] **Step 1: Write the failing test for the pure bounds/name logic**

```ts
// src/location/offlineMapCache.test.ts
import { computeBounds, packNameForJourney } from './offlineMapCache';

test('packNameForJourney is stable and unique per journey id', () => {
  expect(packNameForJourney(7)).toBe('journey-7');
  expect(packNameForJourney(8)).toBe('journey-8');
});

test('computeBounds covers both the user and the destination, with padding', () => {
  const [[minLng, minLat], [maxLng, maxLat]] = computeBounds(51.5, -0.1, 51.6, -0.2);
  expect(minLng).toBeLessThan(-0.2);
  expect(minLat).toBeLessThan(51.5);
  expect(maxLng).toBeGreaterThan(-0.1);
  expect(maxLat).toBeGreaterThan(51.6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/location/offlineMapCache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/location/offlineMapCache.ts
import Mapbox from '@rnmapbox/maps';
import { Journey } from '../types/journey';

const PADDING_DEGREES = 0.02;

export function packNameForJourney(journeyId: number): string {
  return `journey-${journeyId}`;
}

export function computeBounds(
  userLat: number,
  userLng: number,
  destLat: number,
  destLng: number
): [[number, number], [number, number]] {
  const minLat = Math.min(userLat, destLat) - PADDING_DEGREES;
  const maxLat = Math.max(userLat, destLat) + PADDING_DEGREES;
  const minLng = Math.min(userLng, destLng) - PADDING_DEGREES;
  const maxLng = Math.max(userLng, destLng) + PADDING_DEGREES;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export async function cacheAreaForJourney(journey: Journey, userLat: number, userLng: number): Promise<void> {
  const bounds = computeBounds(userLat, userLng, journey.destinationLat, journey.destinationLng);
  await Mapbox.offlineManager.createPack({
    name: packNameForJourney(journey.id),
    styleURL: Mapbox.StyleURL.Dark,
    bounds,
    minZoom: 8,
    maxZoom: 14,
  });
}

export async function removeAreaCacheForJourney(journeyId: number): Promise<void> {
  await Mapbox.offlineManager.deletePack(packNameForJourney(journeyId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/location/offlineMapCache.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire caching into `NewJourneyScreen`'s `handleStart`**

In `src/screens/NewJourneyScreen.tsx`, add the import:

```tsx
import { cacheAreaForJourney } from '../location/offlineMapCache';
```

In `handleStart`, immediately after `await startTracking(journey);` and before `navigation.replace(...)`, add:

```tsx
await cacheAreaForJourney(journey, userLat, userLng);
```

- [ ] **Step 6: Wire eviction into `CurrentJourneyScreen`'s cancel handler**

In `src/screens/CurrentJourneyScreen.tsx`, add the import:

```tsx
import { removeAreaCacheForJourney } from '../location/offlineMapCache';
```

In the `onPress` of the "Cancel journey" alert button, immediately after `await stopTracking();` and before `navigation.replace('Journeys');`, add:

```tsx
await removeAreaCacheForJourney(journey.id);
```

- [ ] **Step 7: Wire eviction into `AlarmScreen`'s arrival-dismiss handler**

In `src/screens/AlarmScreen.tsx`, add the import:

```tsx
import { removeAreaCacheForJourney } from '../location/offlineMapCache';
```

In `handleDismiss`, inside the `if (kind === 'arrival')` block, immediately after `await stopTracking();` and before `navigation.replace('Journeys');`, add:

```tsx
await removeAreaCacheForJourney(journeyId);
```

- [ ] **Step 8: Run the full suite and type-check**

Run: `npx jest && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/location/offlineMapCache.ts src/location/offlineMapCache.test.ts \
  src/screens/NewJourneyScreen.tsx src/screens/CurrentJourneyScreen.tsx src/screens/AlarmScreen.tsx
git commit -m "Add offline map caching for the active journey's area"
```

---

## After Task 30

Run the full manual device walkthrough from Task 17, Step 5, end to end now that every screen exists: fresh install → grant permissions → search for or pin a nearby destination → create the journey → background the app → arrive within the radius → confirm the full-screen alarm → dismiss → confirm the journey shows as completed on the Journeys screen. Additionally verify offline behavior specifically: after starting a journey, enable airplane mode and confirm the Current Journey map still renders using the cached area. This is the MVP's real acceptance test; nothing in the automated suite substitutes for it, since the core value proposition (waking someone up while backgrounded, without connectivity) is exactly the part Jest cannot exercise.
