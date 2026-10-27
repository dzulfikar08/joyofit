#!/usr/bin/env python3
"""App Store provisioning profile for a CI runner, from the App Store Connect API. Standard library and openssl only.

    asc-ci-profile.py <bundle id> <Apple Distribution certificate serial, hex> <out .mobileprovision> [required entitlement ...]

Registers the bundle id when it is missing (the Live Activity extension's), then finds the certificate on App Store Connect by serial, reuses the ACTIVE IOS_APP_STORE profile "joyo-ci <bundle id>
<cert id>" or creates it, writes the profile and prints "<uuid>", a tab, "<profile name>". A profile that is not
ACTIVE (enabling a capability makes it INVALID) or lacks a required entitlement is deleted and recreated. Needs
ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (.p8 key with access to Certificates, Identifiers & Profiles). The profile is separate from the ones scripts/build-ios-mac.sh
("joyo-mac ...") and the Linux pipeline make, so the flows never invalidate each other's profile.
"""

import base64
import json
import os
import plistlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com"


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_raw(der):
    """ECDSA DER signature -> r||s, 32 bytes each (what JWT ES256 wants)."""
    assert der[0] == 0x30
    pos = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        assert der[pos] == 0x02
        length = der[pos + 1]
        parts.append(int.from_bytes(der[pos + 2 : pos + 2 + length], "big"))
        pos += 2 + length
    return b"".join(p.to_bytes(32, "big") for p in parts)


def token():
    key_id, issuer, key = os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], os.environ["ASC_KEY_PATH"]
    now = int(time.time())
    header = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode())
    claims = b64url(json.dumps({"iss": issuer, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}).encode())
    signing_input = f"{header}.{claims}".encode()
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key], input=signing_input, capture_output=True, check=True).stdout
    return f"{header}.{claims}.{b64url(der_to_raw(der))}"


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: HTTP {e.code}\n{e.read().decode(errors='replace')}")
    return json.loads(raw) if raw else {}


if len(sys.argv) < 4:
    sys.exit(__doc__)
bundle, serial, out = sys.argv[1], sys.argv[2].upper().lstrip("0"), Path(sys.argv[3])
required = sys.argv[4:]


def granted_entitlements(profile):
    """The Entitlements dict of a profile: the plist sits inside the CMS signature as plain XML."""
    data = base64.b64decode(profile["attributes"]["profileContent"])
    start, end = data.index(b"<?xml"), data.rindex(b"</plist>") + len(b"</plist>")
    return plistlib.loads(data[start:end]).get("Entitlements", {})


def usable(profile):
    if profile["attributes"]["profileState"] != "ACTIVE":
        return False
    have = granted_entitlements(profile)
    missing = [k for k in required if k not in have]
    if missing:
        print(f"profile '{profile['attributes']['name']}' lacks {', '.join(missing)}; recreating", file=sys.stderr)
    return not missing

certs = call("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200")["data"]
found = [c for c in certs if c["attributes"].get("serialNumber", "").upper().lstrip("0") == serial]
if not found:
    sys.exit(f"no Apple Distribution certificate with serial {serial} on App Store Connect (revoked or expired?)")
cert_id = found[0]["id"]

bundle_ids = call("GET", f"/v1/bundleIds?filter[identifier]={urllib.parse.quote(bundle)}&limit=200")["data"]
bundle_ids = [b for b in bundle_ids if b["attributes"]["identifier"] == bundle]
if not bundle_ids:
    print(f"registering bundle id {bundle}", file=sys.stderr)
    bundle_ids = [call("POST", "/v1/bundleIds", {"data": {"type": "bundleIds", "attributes": {
        "identifier": bundle, "name": bundle.replace(".", " "), "platform": "IOS",
    }}})["data"]]

name = f"joyo-ci {bundle} {cert_id}"
listed = call("GET", f"/v1/profiles?filter[name]={urllib.parse.quote(name)}&filter[profileType]=IOS_APP_STORE&limit=200")["data"]
active = [p for p in listed if usable(p)]
for stale in listed:
    if stale not in active:
        call("DELETE", f"/v1/profiles/{stale['id']}")
        print(f"deleted {stale['attributes']['profileState']} profile '{name}'", file=sys.stderr)
if active:
    profile = active[0]
else:
    profile = call("POST", "/v1/profiles", {"data": {
        "type": "profiles",
        "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle_ids[0]["id"]}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        },
    }})["data"]
    print(f"created App Store profile '{name}'", file=sys.stderr)
    still_missing = [k for k in required if k not in granted_entitlements(profile)]
    if still_missing:
        sys.exit(f"the new profile does not grant {', '.join(still_missing)}; enable the capability on the bundle id")
out.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(profile["attributes"]["uuid"], name, sep="\t")
