# One SQLite library per database file

`joyofit.db` is written by JS (expo-sqlite) and by Kotlin (the watch sync, the multi-watch stores, the Huawei import, the Health
Connect export, the cycle/body/diet stores). It is corrupted when two copies of SQLite open it in the same process.

## What went wrong

expo-sqlite bundles its own SQLite (`vendor/sqlite3`, 3.50.3, every symbol prefixed `exsqlite3_`, so it cannot clash with the
system copy; `libexpo-sqlite.so`). The Kotlin side used Android's framework SQLite (`android.database.sqlite`, `libsqlite.so`
of the phone's firmware). That is the case in
<https://www.sqlite.org/howtocorrupt.html> section 2.2.1, "Multiple copies of SQLite linked into the same application":

- SQLite coordinates connections with POSIX advisory locks (`fcntl`). Those locks belong to the **process**, so a lock taken by
  the framework copy never blocks the expo copy and the reverse. Neither `busy_timeout` nor any journal mode helps: the two copies
  keep their own in-process bookkeeping of who holds what (`unixInodeInfo`) and never see each other. Both could write at once.
- Closing a file descriptor in either copy drops **all** the process's locks on that file (POSIX), including the other copy's.
  JS opened and closed connections of its own all the time (`buildSchemaOnce`, `withExclusiveTransactionAsync`, the repair), each
  `close()` silently released the Kotlin connection's locks, and the WAL index (`-shm`, memory-mapped by both copies, guarded by
  the same fcntl locks) lost its protection too.

Evidence from the phone that was blocked: `SQLiteLog: (11) database corruption at line 71876 of [a881857822]`. expo-sqlite
installs no log callback and its source id is `3ce993b8...`; `SQLiteLog` lines with another source id are the framework copy,
which is the one that tripped over the damage (`SELECT tracks_health FROM device`). The other devices that had a corrupt file
(commits a22fcb6, e74d070) are the same bug.

The JS recovery added then could not remove the cause, and on its own it also suffered from it: it replaced the file's content
while the native copy kept writing (the foreground service, the link, the P2P health data and the Health Connect export were not
stopped), so the check after the install failed.

## The fix

Android: native code opens `joyofit.db` through **the same library JS uses**.

- `ExpoSqliteConnection.java` calls expo-sqlite's JNI classes (`NativeDatabaseBinding`, `NativeStatementBinding`); it is Java
  because expo declares them `internal`, which only Kotlin enforces. `WearDatabase.kt` gives the stores the `SQLiteDatabase`
  surface they used (`rawQuery`, `execSQL`, `compileStatement`, transactions, `version`) on top of it, with one lock per
  database: a transaction owns the connection until `endTransaction`, so other threads wait instead of interleaving.
- With one library in the process SQLite's own bookkeeping covers JS and Kotlin: locks conflict, `busy_timeout` works
  (`PRAGMA busy_timeout = 10000` on the native connection, on the app's handle, on `withExclusiveTransactionAsync` connections and
  in `migrate`), WAL is shared correctly.
- Nothing deletes the file any more: Android's default corruption handler (delete the file) was already replaced by one that only
  logs; `WearDatabase` only logs and throws `SQLiteDatabaseCorruptException`.
- `releaseDatabase` / `resumeDatabase` (module functions) close the native connection and keep it closed while the JS repair
  replaces the file, so a file is never replaced while Kotlin holds it. The repair also stops the foreground service, closes the
  watch link and holds off the app's reconnect first (`pauseNativeWriter`, `src/db/recovery/index.ts`).

Requires a native build (new Gradle dependency `:expo-sqlite` and `consumer-rules.pro` keeping expo's two JNI classes, new Java/Kotlin; on iOS the `ExpoSQLite` pod dependency). Existing users: the file format is the same,
nothing to migrate; the first start after the update opens the same file with the other library (WAL recovery handles a leftover
`-wal`). A file that is already damaged goes through the JS repair (`quick_check` at start, `src/db/recovery`).

iOS had the same arrangement and gets the same fix: `modules/huawei-wear/ios/SQLiteDatabase.swift` used Apple's `sqlite3_*` while
expo-sqlite is its own `exsqlite3_*` copy. With `canImport(ExpoSQLite)` (the pod, a new `s.dependency 'ExpoSQLite'` in
`HuaweiWear.podspec`; the `sqlite3` system library is no longer linked) it forwards the handful of functions it uses to expo's
copy under the usual names; the logic tests (macOS, Linux) have no expo-sqlite and keep the system copy. `SyncStore.release()` /
`resume()` back the module functions `releaseDatabase` / `resumeDatabase` on both platforms. Only a build of the iOS app proves
that the `exsqlite3_*` declarations are visible to the HuaweiWear module (the Linux CI cannot compile that branch).

## Rules

- Never open `joyofit.db` with `android.database.sqlite` (or any second SQLite library) in native code.
- A new native store gets its database from `SyncStore` (`WearDatabase`).
- Never replace, rename or delete the file while a connection of either side is open: `releaseDatabase` first.
- Keep `ExpoSqliteConnection.java` in step with `node_modules/expo-sqlite/android` when expo-sqlite is upgraded (it fails to
  compile, not at run time, when the JNI classes change).
