package com.joyodigitama.huaweiwear;

import android.database.Cursor;
import java.io.Closeable;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * The rows of a query, read completely: `moveToFirst`/`moveToNext` and the typed getters of Android's {@link Cursor}, with the same
 * conversions (a number read as text, text read as a number).
 *
 * Java, not Kotlin, on purpose: `getString` returns a platform type there, as it does on Android's cursor. The stores read
 * columns that cannot be NULL without a check and others behind `isNull`; a Kotlin `String?` would force a choice at every one of
 * them, and `JSONArray(c.getString(1))` would silently resolve to the `JSONArray(Object)` constructor, which throws at run time.
 */
public final class WearCursor implements Closeable {
  private final List<? extends List<?>> rows;
  private final int columnCount;
  private int position = -1;

  public WearCursor(List<? extends List<?>> rows, int columnCount) {
    this.rows = rows;
    this.columnCount = columnCount;
  }

  public int getCount() {
    return rows.size();
  }

  public int getColumnCount() {
    return columnCount;
  }

  public boolean moveToFirst() {
    position = 0;
    return !rows.isEmpty();
  }

  public boolean moveToNext() {
    if (position < rows.size()) position++;
    return position < rows.size();
  }

  private Object value(int column) {
    return rows.get(position).get(column);
  }

  public boolean isNull(int column) {
    return value(column) == null;
  }

  public long getLong(int column) {
    Object v = value(column);
    if (v instanceof Long) return (Long) v;
    if (v instanceof Double) return ((Double) v).longValue();
    if (v instanceof String) {
      try {
        return Long.parseLong((String) v);
      } catch (NumberFormatException e) {
        try {
          return (long) Double.parseDouble((String) v);
        } catch (NumberFormatException ignored) {
          return 0L;
        }
      }
    }
    return 0L;
  }

  public int getInt(int column) {
    return (int) getLong(column);
  }

  public double getDouble(int column) {
    Object v = value(column);
    if (v instanceof Double) return (Double) v;
    if (v instanceof Long) return ((Long) v).doubleValue();
    if (v instanceof String) {
      try {
        return Double.parseDouble((String) v);
      } catch (NumberFormatException e) {
        return 0.0;
      }
    }
    return 0.0;
  }

  public String getString(int column) {
    Object v = value(column);
    if (v == null) return null;
    if (v instanceof ByteBuffer) return new String(bytesOf((ByteBuffer) v), StandardCharsets.UTF_8);
    if (v instanceof byte[]) return new String((byte[]) v, StandardCharsets.UTF_8);
    return v.toString();
  }

  public byte[] getBlob(int column) {
    Object v = value(column);
    if (v == null) return null;
    if (v instanceof ByteBuffer) return bytesOf((ByteBuffer) v);
    if (v instanceof byte[]) return (byte[]) v;
    if (v instanceof String) return ((String) v).getBytes(StandardCharsets.UTF_8);
    return null;
  }

  /** {@link Cursor#FIELD_TYPE_INTEGER} and the other `FIELD_TYPE_*` constants. */
  public int getType(int column) {
    Object v = value(column);
    if (v == null) return Cursor.FIELD_TYPE_NULL;
    if (v instanceof Long) return Cursor.FIELD_TYPE_INTEGER;
    if (v instanceof Double) return Cursor.FIELD_TYPE_FLOAT;
    if (v instanceof ByteBuffer || v instanceof byte[]) return Cursor.FIELD_TYPE_BLOB;
    return Cursor.FIELD_TYPE_STRING;
  }

  private static byte[] bytesOf(ByteBuffer buffer) {
    byte[] out = new byte[buffer.remaining()];
    buffer.duplicate().get(out);
    return out;
  }

  @Override
  public void close() {}
}
