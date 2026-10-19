# ExpoSqliteConnection.java calls expo-sqlite's JNI classes directly. Their natives are registered by name from libexpo-sqlite.so
# (fbjni), so a build that renames or removes them (R8 minification) must not touch them. expo-sqlite marks them @DoNotStrip as well;
# this keeps them for as long as this module uses them, whatever the app's shrinker settings are.
-keep class expo.modules.sqlite.NativeDatabaseBinding { *; }
-keep class expo.modules.sqlite.NativeStatementBinding { *; }
