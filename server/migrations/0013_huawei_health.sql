-- Huawei Health Service Kit (lab, docs/huawei-health-kit.md "Sync from the cloud API"): the HUAWEI ID grant of a JoyoRogo
-- user. The Worker holds the client secret, so token refresh and revoke happen here; the phone only ever receives the
-- one-hour access token and reads Health Kit itself. No Huawei Health data is stored on the server.
-- Rows are deleted on disconnect, on account deletion, and when Huawei reports the refresh token expired (1203).
CREATE TABLE huawei_health_connection (
  user_id TEXT PRIMARY KEY NOT NULL,
  -- AES-GCM ciphertext of the refresh token, `<base64url(iv)>.<base64url(ciphertext)>`, key from the
  -- HUAWEI_HEALTH_TOKEN_KEY secret.
  refresh_token TEXT NOT NULL,
  -- Space-delimited scopes the user granted.
  scope TEXT NOT NULL,
  -- Unix seconds of the first connect.
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
