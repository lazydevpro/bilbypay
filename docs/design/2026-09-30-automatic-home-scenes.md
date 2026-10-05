# Automatic Home environment

Home now follows the device's local time. There is no scene picker, scene selection row, or `/nook` route.

| Local hour | Environment | Bilby position | Greeting |
|---|---|---|---|
| 05:00–11:59 | Morning meadow | Right | Good morning. |
| 12:00–16:59 | Warmer afternoon meadow, shifted sun | Left | Good afternoon. |
| 17:00–20:59 | Evening nook | Center | Good evening. |
| 21:00–04:59 | Moonlit garden | Left | Hello, night owl. |

The clock refreshes every minute and immediately when the app returns to the foreground or the browser tab becomes visible. It uses local time, including the device's current time zone. Decorative mailbox placement moves to the opposite side of Bilby; centered compositions omit it.

Scenes explicitly selected by the app for a particular screen retain their contextual composition. They are not user preferences and do not represent account progress.

## Motion preference

Settings contains the persistent **Animate Bilby** switch. Device reduced motion continues to take priority. The existing storage key remains compatible, but only `motionEnabled` is parsed and saved. Older `scene` fields are ignored.

The switch remains disabled until storage loads. If reading storage fails, Bilby remains still and Settings offers a retry. If saving fails, the previous preference stays active and an error is shown.

## Small-screen money layout

Burrow stacks its monetary figure and decorative garden below 380 points of viewport width. Its amount no longer uses a one-line ellipsis, so the full value remains available at 320 points and when text grows.

## Verification

- ESLint passes for all changed state, scene, Home, Settings and Burrow files.
- Full app TypeScript check passes.
- Companion model tests cover period boundaries, local time, invalid clocks and migration from saved scene preferences.
- Companion model, mascot motion and consumer glossary suites pass: 34 tests.
