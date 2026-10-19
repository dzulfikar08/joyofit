package com.joyodigitama.huaweiwear;

import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.database.sqlite.SQLiteException;
import expo.modules.sqlite.NativeDatabaseBinding;
import expo.modules.sqlite.NativeStatementBinding;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * One connection to a SQLite database through the SQLite library that expo-sqlite ships (libexpo-sqlite.so), the same copy the
 * JS side of the app uses for the same file. Android's own SQLite (android.database.sqlite) is a second copy of the library in
 * the process, and two copies cannot coordinate: the POSIX locks SQLite takes on the database and its WAL index belong to the
 * process, not to the library, so a second copy neither waits for the first nor knows what it has open, and closing a file in
 * one copy silently drops the other's locks (https://www.sqlite.org/howtocorrupt.html, "Multiple copies of SQLite linked into
 * the same application"). That is how `joyofit.db` got corrupted. Everything that opens it from native code goes through here.
 *
 * Java, not Kotlin: expo-sqlite declares these classes `internal`, which only Kotlin enforces. The names and signatures used
 * here are those of expo-sqlite 57 ({@code NativeDatabaseBinding}, {@code NativeStatementBinding}); a different shape after an
 * upgrade fails to compile here instead of misbehaving.
 *
 * Not thread-safe: {@link WearDatabase} serializes access.
 */
public final class ExpoSqliteConnection {
  public static final int SQLITE_OK = 0;
  public static final int SQLITE_ROW = 100;
  public static final int SQLITE_DONE = 101;

  private static final Pattern CORRUPT =
      Pattern.compile("database disk image is malformed|malformed database schema|file is not a database", Pattern.CASE_INSENSITIVE);

  /** A prepared statement of this connection. */
  public static final class Statement {
    private final ExpoSqliteConnection owner;
    private final NativeStatementBinding binding;
    private boolean released;

    private Statement(ExpoSqliteConnection owner, NativeStatementBinding binding) {
      this.owner = owner;
      this.binding = binding;
    }

    /** Binds [value] (null, Integer, Long, Double, Boolean, byte[] or String) to the 1-based [index]. */
    public void bind(int index, Object value) {
      owner.check(binding.bindStatementParam(index, value), "bind");
    }

    public void clearBindings() {
      binding.sqlite3_clear_bindings();
    }

    public void reset() {
      binding.sqlite3_reset();
    }

    /** True while [step] produced a row, false at the end of the result. */
    public boolean step() {
      int code = binding.sqlite3_step();
      if (code == SQLITE_ROW) return true;
      if (code == SQLITE_DONE) return false;
      throw owner.error(code, "step");
    }

    public int columnCount() {
      return binding.sqlite3_column_count();
    }

    /** The current row: Long, Double, String, ByteBuffer (a blob) or null for each column. */
    public List<Object> row() {
      return new ArrayList<>(binding.getColumnValues());
    }

    /** Finalizes the statement and releases its native object. */
    public void close() {
      if (released) return;
      binding.sqlite3_finalize();
      release();
    }

    /**
     * Releases the native object of a statement that was finalized already (by {@link ExpoSqliteConnection#close()}, which
     * finalizes every statement it still has): finalizing twice is a use after free.
     */
    public void release() {
      if (released) return;
      released = true;
      binding.close();
    }
  }

  private final NativeDatabaseBinding binding = new NativeDatabaseBinding();
  private boolean opened;

  /** Opens (creating when missing) the database file at [path]. */
  public void open(String path) {
    int code = binding.sqlite3_open(path);
    if (code != SQLITE_OK) {
      SQLiteException failure = error(code, "open");
      binding.sqlite3_close();
      throw failure;
    }
    opened = true;
  }

  /** Runs one or more statements without parameters or results. */
  public void exec(String sql) {
    int code;
    try {
      code = binding.sqlite3_exec(sql);
    } catch (Exception e) {
      // The binding throws expo's SQLiteErrorException with sqlite's message for a failed statement.
      throw classify(String.valueOf(e.getMessage()), e);
    }
    if (code != SQLITE_OK) throw error(code, "exec");
  }

  public Statement prepare(String sql) {
    NativeStatementBinding statement = new NativeStatementBinding();
    int code = binding.sqlite3_prepare_v2(sql, statement);
    if (code != SQLITE_OK) {
      SQLiteException failure = error(code, "prepare");
      statement.sqlite3_finalize();
      statement.close();
      throw failure;
    }
    return new Statement(this, statement);
  }

  /** Rows changed by the most recently completed INSERT, UPDATE or DELETE. */
  public int changes() {
    return binding.sqlite3_changes();
  }

  public long lastInsertRowId() {
    return binding.sqlite3_last_insert_rowid();
  }

  /** Closes the connection; the statements still open are finalized first (and must only be {@link Statement#release released} after). */
  public void close() {
    if (!opened) return;
    opened = false;
    binding.sqlite3_finalize_all_statement();
    binding.sqlite3_close();
    binding.close();
  }

  /** Converts a sqlite result code other than OK into the exception Android code expects from its own SQLite. */
  private SQLiteException error(int code, String what) {
    return classify(what + " failed (" + code + "): " + binding.convertSqlLiteErrorToString(), null);
  }

  private void check(int code, String what) {
    if (code != SQLITE_OK) throw error(code, what);
  }

  private static SQLiteException classify(String message, Throwable cause) {
    SQLiteException out = CORRUPT.matcher(message).find() ? new SQLiteDatabaseCorruptException(message) : new SQLiteException(message);
    if (cause != null) out.initCause(cause);
    return out;
  }
}
