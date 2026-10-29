# Huawei export: converted in the browser, applied on the phone

A Huawei Privacy Centre export can be hundreds of MB zipped and several GB of JSON. The phone's native importer
(`HuaweiExportImporter.kt`, see `docs/app-reference.md` "Import from Huawei Health") reads it on the phone, which is slow on a big
export and needs a store build for every fix. This path splits the work:

1. **Browser** (JoyoFit web app, JoyoRogo repo `apps/fit`, page *Unggah* → tab *Huawei Health*): the person picks the ZIP and types its
   password. A Web Worker decrypts and reads it locally (the ZIP and the password never leave the browser), runs a TypeScript port of
   the native parsers and writes an **import file**: exactly the rows the native importer would hand to `HuaweiImportStore`, gzipped.
2. **Transfer**, either or both:
   - *File*: the page saves the import file; the person moves it to the phone (chat app, Drive, cable) and opens it in JoyoFit.
   - *Account* (JoyoRogo Pro): the page uploads the import file (not the ZIP) to `POST /v1/imports`; the phone lists it, downloads it,
     applies it and deletes it from the server.
3. **Phone** (JS only, so it ships over the air): reads the import file as a stream and writes the rows with the same SQL as
   `SqliteHuaweiImportStore` (`HuaweiImportStore.kt`). The same rules hold: rows are `imported = 1`, watch data wins, the same
   file applied twice adds nothing, meals and water go to `rogo_import_queue`, weigh-ins to `scale_reading` as `pending`.

Nothing is parsed on a server. The server stores at most the import file (tens of MB), and only until the phone has applied it.

## The import file (version 1)

gzip of UTF-8 NDJSON: one JSON value per line, `\n` after every line. Name: `joyofit-import-<YYYYMMDD-HHmm>.ndjson.gz`.
Upload `Content-Type`: `application/x-joyofit-import+gzip` (the phone recognises its uploads by it).

Line 1, the header:

```json
{"format":"joyofit-import","version":1,"source":"huawei-export","createdAt":1792800000000,"exportName":"HUAWEI_HEALTH_20261022112019.zip"}
```

A reader refuses any other `format`, a `version` it does not know, and a file whose last line is not the `end` line (a cut-off
download): it says so and writes nothing.

Then batch lines, in the order the native importer writes them. Every batch is `{"t":"<kind>","rows":[...]}`, each row an array
(fixed positions, `null` where Kotlin has `null`). Times are unix seconds unless named `Ms`.

| `t` | One row | Native source → store call |
| --- | --- | --- |
| `minutes` | `[ts, steps, calories, distance, heartRate, spo2, restingHeartRate]` (calories in small calories) | `ImportedMinute` → `writeMinutes` |
| `sleep` | `[start, end, type, stage]` | `ImportedSleep` → `writeSleep` |
| `metrics` | `[type, ts, value, json]` | `ImportedMetric` → `writeMetrics` (type `emotion` counts as stress) |
| `sleepScores` | `[start, end, score, efficiency]` | `ImportedSleepScore` → `writeSleepScores` |
| `queue` | `[kind, key, payload]` (`meal` / `water`; payload is the JSON text) | `QueuedImport` → `queueForRogo` |
| `weighIns` | `[tsMs, weightKg, impedanceOhm, reportedJson]` | `ImportedWeighIn` → `writeWeighIns` |
| `dayTotals` | `[dayStartSec, dayEndSec, noonSec, steps, distance, calories]` | `ImportedDayTotal` → `writeDayTotals` |

A workout is one line of its own, `{"t":"workout","w":{...}}`, with `w` = `{start, end, sportType, sportName, duration, distance,
calories, steps, avgHr, maxHr, summaryJson, points}` (`ImportedWorkout`; `summaryJson` is the JSON text) and `points` an array of
`[ts, lat, lon, alt, hr, speed, cadence, stride, power]` (`WorkoutPoint`), sorted by `ts`. It goes to `writeWorkout`, including the
repair of an imported row still named "Workout (Huawei type unknown)".

**Order.** The converter keeps the native importer's batching: files in `HuaweiExportKind` order, the buffers flushed between
files and whenever `minutes` reaches 20 000 or `sleep` / `metrics` / `weighIns` 5 000 rows (`FLUSH_MINUTES`, `FLUSH_ROWS`), and
within one flush the native `flush()` order (minutes, sleep, metrics, sleep scores, queue, weigh-ins, day totals). Workouts are
lines where the native importer writes them (one by one, as read). The water queue (`queueWater`) is the last batch before `end`.
Order matters: day totals only fill what the minutes written before them leave, and the first heart rate of a minute wins.

Last line, `end`:

```json
{"t":"end","summary":{...},"profile":{"heightCm":170,"weightKg":68.5,"sex":"male","birthYear":1990}}
```

`summary` holds what the reading found, with the keys of `HuaweiImportSummary.toJs()`: `filesRead`, `filesFailed`, `filesIgnored`,
`badRecords`, `rejectedSamples`, `unmappedSamples`, `heartRateReadings`, `restingHeartRateReadings`, `spo2Readings`, `stressReadings`,
`sleepSegmentsFound`, `metricsFound`, `sleepScoresFound`, `dayTotalsFound`, `mealsFound`, `waterDaysFound`, `weighInsFound`,
`workoutsFound`, `rejectedReasons`, `badRecordReasons`, `unmappedKeys`, `oldestSec`, `newestSec`. The phone adds what writing did
(`minutesWritten`, `sleepSegmentsAdded`, `stressAdded`, `metricsAdded`, `sleepScoresAdded`, `dayTotalsAdded`, `mealsQueued`,
`waterDaysQueued`, `weighInsAdded`, `workoutsAdded`, `workoutsUpdated`, `workoutPointsAdded`, `cancelled`) and shows the result on
the same summary as a native import. `profile` is `profileFromFacts()`: only the keys the export had.

## Parsing in the browser

The TypeScript port follows the Kotlin files one to one (`HuaweiExportJson`, `HuaweiHealthDetailParser`, `HuaweiWeightParser`,
`HuaweiDiaryParser`, `HuaweiSampleSequenceParser`, `HuaweiMotionPathParser` with `HuaweiExportSports` and `WorkoutSportTypes`,
`HuaweiSportsHealthParser` with `HuaweiXlsReader`, and the collector and flush logic of `HuaweiExportImporter`). A change to one
side's rules is a change to the other.

`JSON.parse` is stricter than Android's `org.json` (libcore `JSONTokener`), which accepts unquoted names and values, single-quoted
strings, `=` / `=>` between name and value, `;` between members, comments and bare words (as strings). A record `org.json` reads on
the phone must not be lost in the browser, so a record `JSON.parse` refuses is tried with a lenient reader with those rules before
the numeric-key repair and the motion-path raw-text fallback. One deliberate difference: a bare `NaN` or `Infinity` is a number to
libcore, whose `JSONObject.put` then refuses the whole record; the browser keeps it as a string and reads the rest of the record.

## Server

`api.fit.joyorogo.com` (`server/src/imports.ts`), all behind the session; the web app reaches them through JoyoRogo's proxy
`/api/fit/imports...` (`apps/server/src/fit-proxy.ts` in the JoyoRogo repo).

| Route | Who | What |
| --- | --- | --- |
| `POST /v1/imports?filename=` | Pro (402 otherwise) | stores the body in R2 (existing route) |
| `GET /v1/imports` | signed in | the caller's newest imports with `contentType` (existing) |
| `GET /v1/imports/:id/file` | signed in, own rows | the stored file, streamed; `404` for another user's or a missing one |
| `DELETE /v1/imports/:id` | signed in, own rows | removes the R2 object and the row |

The phone applies an `uploaded` import of type `application/x-joyofit-import+gzip`, then deletes it. A failed apply leaves it on the
server, so it can be retried.

## Phone side (`src/features/huaweiimport/`)

| File | What |
| --- | --- |
| `importFileCore.ts` | no Expo imports: `checkImportFile` (pass 1) and `applyImportSource` (pass 2) over an `ImportSource`, `applyImportFile(db, open, options)` for both |
| `importStoreSql.ts` | the SQL of `SqliteHuaweiImportStore`, statement for statement, on the connection of an exclusive transaction |
| `importFile.ts` | `applyImportFileAt(db, uri, options)`: opens a `file://` or `content://` uri with expo-file-system's `FileHandle` and runs the core |
| `testDb.ts` | bun only: `openImportDb()` (the shipped schema in memory), `applyImportFileAtPath(db, path)` |

Pass 1 reads the whole file once and writes nothing: the header (`format`, `version`), the gzip stream (an inflate error, or an inflated
size that differs from the trailer's, is `corrupt`; fflate does not check the CRC), every line parses as a known batch, and the last line is
`end` with nothing after it. Pass 2 reads it again and applies the batches in file order, one exclusive transaction per batch (consecutive
`workout` lines share one, at most 50 workouts or 20 000 points), the event loop getting a turn at least every 50 ms; it polls `isCancelled`
between batches and reports progress by compressed bytes read. Counts reach the summary only after their transaction committed. A `queue`
batch counts `meal` rows into `mealsQueued` and `water` rows into `waterDaysQueued`.

Reading and applying an arbitrary file from a bun test or script:

```ts
import { applyImportFileAtPath, openImportDb } from '@/features/huaweiimport/testDb';
const f = openImportDb();
const summary = await applyImportFileAtPath(f.db, '/tmp/joyofit-import-sample.ndjson.gz'); // throws ImportFileError for a refused file
f.all('SELECT COUNT(*) AS n FROM step_samples'); // rows read back; f.raw is the bun:sqlite Database
```
