# Caller Man — Design Spec

Date: 2026-09-22
Status: Approved for planning

## 1. Overview

Caller Man is a location-triggered alarm app for React Native (Android-first,
iOS to follow as a later phase). Instead of ringing at a set time, it rings when the
user's device comes within a configurable radius of a chosen destination — aimed at
travelers who doze off on long journeys (train, bus, car) and don't want to miss
their stop.

Source material: `Caller-Man Design.pdf` (problem framing, feature scope, business
rules, and Figma-generated mockups for the core screens — see that document for the
original visuals).

## 2. Target users & constraints

- General public; no accounts, no login, no cloud storage or sync.
- Must work with no internet connectivity mid-journey (offline map caching for the
  currently selected route/area).
- Battery efficiency is the top technical priority — this is a background,
  potentially hours-long GPS-polling app.
- The app must proactively alert the user on GPS loss, low battery, or other
  failures rather than fail silently.
- Only necessary data may be stored, and only locally, with the possible future
  exception of data needed for ads (deferred, out of scope for this phase).

## 3. Platform scope

**Android-first.** iOS has materially stricter background-execution and
notification-interruption rules (no arbitrary background timers, no third-party
DND-bypass entitlement, background location requires the continuous "Location
updates" background mode plus App Store review scrutiny). Rather than design one
compromise experience across both platforms up front, we ship a fully-realized
Android app first and design the iOS phase separately once the Android background
engine and alarm flow are proven. The data model, business rules, and screens below
are written platform-agnostically so the iOS phase is additive, not a rewrite.

## 4. Concurrency model

Only **one journey can be active at a time**. Starting a new journey while one is
active requires ending (cancelling or completing) the current one first. This keeps
the background engine simple: a single location watcher, a single alarm
configuration, no need to run multiple concurrent background trackers.

## 5. Screens

### 5.1 Welcome / Permissions (first boot only)
Requests, with rationale text per item:
- GPS location access (foreground + background)
- Wake up / run in background
- Toggle GPS on/off
- Notifications
- Full-screen alarm display (Android's `USE_FULL_SCREEN_INTENT` / "display over
  other apps" equivalent)
- Bypass silent mode & DND (to the extent the platform allows — see §9)

If GPS or background-location permission is denied, the app re-prompts and does not
proceed (per the source doc, GPS is a hard requirement). If any other permission is
denied, show a warning but allow continued use with degraded behavior (e.g. no
full-screen wake, normal notification only).

### 5.2 Journeys (home)
- List of journey cards (destination, radius, distance, date, status:
  active/completed/cancelled), most recent first.
- If a journey is active, its card is pinned to the top and tapping it opens the
  Current Journey screen.
- Floating "+" button opens New Journey setup.
- Hamburger menu → Default Settings, About.

### 5.3 New Journey setup
- Map (Mapbox) for picking a destination: drag a pin or search.
- Latitude/longitude fields synced to the map pin.
- Alarm radius (5–200 km slider, or custom numeric entry for any positive value via
  a toggle) — capped at a maximum of 40% of the current distance between the user
  and the destination; if the destination changes such that the existing radius
  would exceed that cap, the radius auto-adjusts down.
- Max / min GPS poll frequency sliders (per-minute, `/m`), each with a custom-value
  toggle. Max must stay greater than min; if a change would invert them, the other
  slider auto-adjusts to maintain the constraint.
- Alarm tune picker.
- Low battery cutoff slider (%). If the device's current battery is already below
  the configured default cutoff, the maximum selectable cutoff for this journey is
  capped at `current battery − 5%`.
- All fields pre-filled from Default Settings, fully editable per-journey.
- "Start Journey" begins the journey (creates the `journeys` row, status `active`,
  starts the background task).

### 5.4 Default Settings
Holds the values that pre-fill New Journey setup: alarm radius, max/min poll
frequency, alarm tune, low battery cutoff, and **snooze duration** (minutes,
configurable — added per your request; no fixed default is being assumed beyond a
reasonable slider range, e.g. 1–15 minutes).

### 5.5 About
Static text (app name/version, short note from the author, donation link) as
described in the source doc — no dynamic content.

### 5.6 Current Journey (new — not mocked in the source doc, designed here)
Shown while a journey is active; the app opens straight into this screen on cold
start if an active journey exists in storage.
- Mapbox map centered on live position: current-location marker, destination
  marker, radius circle.
- Info panel: destination, radius, current estimated speed, estimated arrival time,
  estimated alarm time (or "estimating…" if not enough data yet — see §8).
- "Cancel journey" action (confirms, then marks the journey `cancelled` and stops
  the background task).
- The Android foreground-service notification (required to keep the background
  task alive, see §7) mirrors destination + remaining distance; tapping it opens
  this screen.

### 5.7 Alarm-fired (new — designed here)
Full-screen takeover, triggered the moment a poll lands inside the radius:
- Brought to the foreground over the lock screen via a full-screen-intent
  notification (the same Android mechanism alarm-clock and incoming-call apps use).
- Loud, looping alarm tune (the journey's selected tune) + vibration.
- "You've arrived near `<destination>`" message.
- **Snooze**: dismisses this screen and re-shows it after the configured snooze
  duration (from Default Settings, §5.4). The journey remains `active` while
  snoozed.
- **Dismiss**: marks the journey `completed` and stops the background task.

## 6. Data model (SQLite via `expo-sqlite`)

**`journeys`**
| column | notes |
|---|---|
| id | primary key |
| name | user-editable label |
| destination_lat, destination_lng | |
| radius_m | |
| max_poll_freq, min_poll_freq | per-minute |
| alarm_tune | |
| battery_cutoff_pct | |
| status | `active` \| `completed` \| `cancelled` |
| created_at, completed_at | |

**`default_settings`**
Single row: radius_m, max_poll_freq, min_poll_freq, alarm_tune,
battery_cutoff_pct, snooze_minutes.

**`location_log`**
| column | notes |
|---|---|
| id | primary key |
| journey_id | FK |
| lat, lng, speed, accuracy | raw fix data |
| recorded_at | |

`location_log` accumulates only while a journey is active and is pruned once the
journey ends — trip history cards only need the summary fields already on
`journeys`, not the raw trail (route/trail detail view is explicitly out of scope
for this phase, per your confirmation).

## 7. Background location engine (Android)

- **`expo-location`**, using its background location API
  (`startLocationUpdatesAsync`) with Android's foreground-service configuration —
  this gives us the required persistent "tracking active" notification and keeps
  the process alive, matching how navigation apps behave.
- **`expo-task-manager`** defines the background task that receives each location
  fix and runs the logic in §8.
- Requires a dev-client / prebuilt native project (not Expo Go), since Mapbox's
  native SDK also requires this regardless of the location library choice.
- The `react-native-background-geolocation` paid library was evaluated and
  deliberately **deferred** — Android's built-in foreground-service support via
  `expo-location`/`expo-task-manager` is sufficient and well-trodden for this use
  case. Revisit this decision specifically when scoping the iOS phase, where
  background-execution constraints are materially harder.

## 8. Polling, radius check, and estimation

On each delivered fix, while a journey is active:

1. **Radius check**: haversine distance from the fix to the destination. If ≤
   radius → fire the alarm (§5.7) immediately and stop further polling for this
   journey until dismissed/snoozed.
2. **Next poll interval** (robust, not speed-dependent — deliberately decoupled
   from the estimate below so a bad speed estimate can never cause under-polling
   near the destination): linear interpolation between the journey's min and max
   poll frequency based on `remaining_distance / initial_distance_at_setup`
   (clamped to [0, 1]). Far from the destination → interval near the min
   frequency; close to it → interval near the max frequency. `expo-location`'s
   update interval is reconfigured accordingly after each fix.
3. **Speed / ETA / estimated alarm time** (informational only, shown on the
   Current Journey screen): rolling average speed from the last few
   `location_log` entries within a short time window (e.g. last 2–3 minutes) —
   preferred over the device's instantaneous reported speed, which is noisier.
   `ETA = remaining_distance / avg_speed`;
   `estimated_alarm_time = (remaining_distance − radius) / avg_speed`. Shown as
   "estimating…" until enough fixes exist or while speed is ~0 (e.g. stopped in
   traffic).
4. **GPS-loss handling**: if the next expected fix doesn't arrive within
   `current poll interval + user-configured grace period`, raise a "lost GPS"
   alert (reuses the alarm-fired presentation, §5.7, with different messaging) so
   the user isn't silently left untracked.
5. **Low battery**: if battery drops to the journey's configured cutoff, raise a
   low-battery alert the same way, before the OS potentially kills background
   work.

## 9. Alarm interruption behavior (Android specifics)

"Bypass silent mode & DND" and "display over other apps" from the source doc map
to: a full-screen-intent notification with `USE_FULL_SCREEN_INTENT` permission
(brings the app to the foreground over the lock screen, the same mechanism
alarm-clock/incoming-call apps use) plus playing the alarm tune through the alarm
audio stream. This is the closest Android equivalent to a "real alarm clock"
experience and is what the Welcome/Permissions screen (§5.1) requests.

## 10. Non-goals for this phase

- iOS support (separate future phase; see §3).
- Ads / any data collection beyond what's needed for core functionality.
- Imperial units (metric only — km/m, matching the mockups).
- Trip route/trail detail view in history (only the summary fields on `journeys`).
- Multiple concurrent active journeys (§4).
- Cloud sync, accounts, or login.

## 11. Open items deferred to implementation planning

- Exact haversine/interpolation implementation details and unit tests.
- Persistent-notification content/format details (Android foreground service).
- Exact permission-request copy/rationale strings for §5.1.
- Crash-recovery behavior beyond "resume into Current Journey screen if an active
  journey exists in storage on cold start" (source doc's consideration #5 —
  alerting the user after an app crash mid-journey — needs a concrete mechanism,
  e.g. a watchdog/last-heartbeat check on next launch).
