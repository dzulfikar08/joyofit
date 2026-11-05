# Huawei Health 17.0.8.300 `libPgnssJni.so`: on-disk format of the PGNSS (predicted ephemeris) files

Static analysis only (Ghidra 12.2 decompilation `pgnss_decomp.c`, plus functions Ghidra had not created and that were decompiled again in a read-only headless run; objdump spot checks; jadx of `dex/classes31.dex` for the Java caller). The run in `eph.log` is used only to confirm sizes and times.

Notation: `[CODE: FUN_x@addr]` = read directly from the decompiled code or disassembly. `[INFERENCE]` = my interpretation (names, units, intent). All addresses are Ghidra addresses (image base 0x100000). The file offset is `addr - 0x100000` for `.text`/`.rodata`.

The decoder object is a singleton context `ctx = PTR_DAT_00174c70`. These names are used below:

| name in this doc | code |
|---|---|
| `GenerateGpsEph` (wear) | `FUN_001460ec` (vtable `0x1719c0`) |
| `GenerateQzsEph` (wear) | `FUN_0014651c` |
| `GenerateGalEph` (wear) | `FUN_0014692c` |
| `GenerateBdsEph` (wear) | `FUN_00146d3c` |
| `GenerateGloEph` (wear) | `FUN_00147880` |
| `decodeEph` driver (reads the seed, calls all of the above, gzip) | `FUN_00144c3c` |
| `GenerateAssistData` (EXTRA) | `FUN_001453b0` |
| `CompressFileWithGzip` | `FUN_00145cd0` |
| `GetHwEphPath` | `FUN_0013351c` |
| `PredictOrbClk` | `FUN_00138ee0` |
| `FitBceOrbit16` | `FUN_001393e8` |
| `GetEphFitSessionId` | `FUN_0013ae88` |
| `GetOrbitPredict` (Chebyshev evaluation) | `FUN_0013b03c` |
| `DecodeGnssBit` | `FUN_00135768` (+ `FUN_0013866c`, `FUN_00138868`, `FUN_00138a94`) |
| bit reader `LoadBits(reader, out, unsigned, nbits)` | `FUN_00131654` |
| `GetSeedInfo` | `FUN_0013218c` |
| file helpers: write `"wb"` / append `"ab"` / overwrite at offset 0 `"rb+"` | `FUN_001430b4` / `FUN_00143300` / `FUN_00143740` (`WriteSpecificBufferToFile`) |

---

## 1. Call flow, file names, compression

### 1.1 Java side [CODE: jadx `PgnssManager`, `gtw`]
- `gtw.d(urls)`: a tag containing `HW_PGNSS_PRED` gives ephType 2 (`PgnssManager.d` request; the URL map value is `"HW_PGNSS"`).
- `gtw.c(urls)`: **ephMode = 1 only if a tag contains `"SEVEN"`**, otherwise 0. The Fit 4 Pro tag `…HW_EEV2/HW_PGNSS_PRED;` has no `SEVEN`, so mode = 0.
- `PgnssManager.b(resp, mode)`: deletes the old `<dir>/<deviceIdentify><NAME>` files. Then it calls `initEnv(gpsTime, storageDir, deviceIdentify)` with `gpsTime = unixSeconds - 315964782`, which is GPS seconds since 1980-01-06 with an 18 s leap offset hard-coded. Then it calls `decodeEphSeeds(mode)`. Then, for NAME in `HW_PGNSS_GPS, HW_PGNSS_GLONASS, HW_PGNSS_GALILEO, HW_PGNSS_BDS, HW_PGNSS_QZS, HW_PGNSS_EXTRA`, it returns `{path → NAME}` if the file exists.

### 1.2 Native side
- `initEnv` stores `storageDir` in `DAT_00179560` and `deviceIdentify` in `DAT_00179578` [CODE: initEnv@0014467c → FUN_00133b24/FUN_00133b30].
- **The full path is `storageDir + deviceIdentify + NAME`. There is no hashing and no separator.** Example: `/data/user/0/com.huawei.health/files/8124D89E…E775HW_PGNSS_GPS` [CODE: GetHwEphPath FUN_0013351c@0013351c; FUN_00133b3c@00133b3c for EXTRA]. The `gpsTime` argument of `GetHwEphPath` is only logged; it is not part of the name. The `pDeviceIdentify` string is supplied by Java and is opaque here. It is the 64-hex string in the log [INFERENCE: some SHA-256 of a device id].
- The seed (downloaded JSON) is read from `storageDir + deviceIdentify + "HW_PGNSS"` [CODE: FUN_00132bd8@00132bd8, used by FUN_00144c3c and GetSeedInfo]. It is read into a 0x190000-byte buffer and must contain `"HiEE":[` and `]}` [CODE: FUN_00144c3c@00144c3c].
- `GetHwEphPath` type index: 0 = GPS, 1 = GLONASS, 2 = BDS, 3 = GALILEO, 4 = QZS [CODE: FUN_0013351c].
- `decodeEphSeeds(mode)` stores `mode` in `ctx+0x98` [CODE: Java_…decodeEphSeeds@001445b4 → FUN_00131960]. Effects of `ctx+0x98 == 1` ("SEVEN" mode):
  - each constellation generator loops **7 days instead of 3** (`lVar = (mode==1) ? 7 : 3`) [CODE: FUN_001460ec, FUN_0014651c, FUN_0014692c, FUN_00146d3c, FUN_00147880];
  - after generation the five ephemeris files are **gzip-compressed in place** (zlib `gzopen(tmp,"wb9")`, 4 KiB `gzwrite` loop, `remove(orig)`, `rename(tmp,orig)`). The name does not change and there is no `.gz` suffix. Order: GPS, QZS, GAL, BDS, GLO [CODE: FUN_00144c3c@00144f50…; FUN_00145cd0@00145cd0; mode string `"wb9"` at 0x115af5].
  - `HW_PGNSS_EXTRA` is **never** compressed.
- In mode 0 (the Fit 4 Pro case, and the `eph.log` run) **nothing is gzipped**. `eph.log` has no `CompressFileWithGzip` line, which agrees.
- Order in one run [CODE: FUN_00144c3c]: GPS (vtable +0x18), GAL (+0x28), BDS (+0x30), GLO (+0x38), QZS (+0x20), then `GenerateAssistData`, then the optional gzip.

### 1.3 Endianness and packing
All files are `fwrite` of native arm64 C structs. **All multi-byte integers are little-endian.** Struct padding bytes are 0, because every buffer is `memset(0)` before it is filled [CODE: every builder calls `FUN_0012f5e0(buf,size,0,size)` first].

---

## 2. Common ephemeris-file layout (`HW_PGNSS_GPS/QZS/GALILEO/BDS/GLONASS`)

[CODE: FUN_001460ec@001460ec (GPS); FUN_0014651c (QZS); FUN_0014692c (GAL); FUN_00146d3c (BDS); FUN_00147880 (GLO)]

1. A zeroed 0x3F0-byte header is written with `"wb"`.
2. Each block is appended with `"ab"`.
3. At the end the filled header is rewritten at offset 0 with `"rb+"` (`WriteSpecificBufferToFile`).

### 2.1 Header: 1008 bytes = 84 entries × 12 bytes

| offset | size | type | meaning |
|---|---|---|---|
| 12·i + 0 | 4 | u32 LE | slot time: GPS seconds since 1980-01-06 (see 2.3 per constellation) |
| 12·i + 4 | 4 | u32 LE | absolute file offset of the block (the first block is at 0x3F0 = 1008) |
| 12·i + 8 | 4 | u32 LE | block size in bytes (constant per constellation) |

- 84 entries = 7 days × 12 slots. Mode 0 fills **36** (3 days); SEVEN mode fills **84**. Unused entries stay all-zero [CODE: as above; `auStack_460[0x3f0]`].
- Entries are filled in order without gaps. If a slot fails (`get … eph err`), the code `break`s out of that day. The remaining slots of that day are skipped, and the next day's slots take the following entries. So times are not always contiguous, and offsets are always packed [CODE: FUN_001460ec inner `do…while(iVar6 != 0xc)` with `break`].
- **Community prior (Me7c7):** "72-slot header + 2564-byte blocks of 80-byte records". The block and record sizes are confirmed for GPS. **The header is 84 entries (1008 B), not 72.** Only 36 of them are used in the default (non-SEVEN) mode.

### 2.2 Block = `u8 count; u8 pad[3]; record[count]; zero-fill to fixed block size`

| constellation | block size | record size | max records | header entry size field | file size, mode 0 / SEVEN (before gzip) |
|---|---|---|---|---|---|
| GPS | 0xA04 = 2564 | 0x50 = 80 | 32 | 2564 | 1008+36·2564 = **93 312** / 216 384 |
| QZSS | 0x2FC = 764 | 0x4C = 76 | 10 | 764 | 28 512 / 65 184 |
| Galileo | 0xAB4 = 2740 | 0x4C = 76 | 36 | 2740 | 99 648 / 231 168 |
| BeiDou | 0x16A8 = 5800 | 0x5C = 92 | 63 | 5800 | 209 808 / 488 208 |
| GLONASS | 0x4E4 = 1252 (sub-block) | 0x34 = 52 | 24 | **0x2720 = 10016 = 8 sub-blocks** | 1008+288·1252 = 361 584 / 842 352 |

`count` = number of valid records [CODE: GPS FUN_00136260 `*param_4` += 1 per record, record at `param_4 + 4 + n·0x50`; QZS FUN_0013688c `+4+n·0x4C`, limit `<10`; GAL FUN_00136eb8 limit `<0x24`; BDS FUN_001374f4 `+4+n·0x5C`, limit `<0x3F`; GLO FUN_00137ed0 `+4+n·0x34`, limit `<0x41` input sats]. GPS limit `<0x20` [CODE: FUN_00136260]. The block is always written at full size. Satellites whose fit failed, or that are unhealthy, or whose value overflowed in the range check are skipped and leave no hole.

### 2.3 Slot timing

Let `t0 = initEnv gpsTime` and `base = floor(t0/7200)·7200`. Days are `d = 0…(2 or 6)`, slots are `k = 0…11`.

| file | per-day fit query time | slot (header) time | record epoch |
|---|---|---|---|
| GPS, QZS, GAL | `base + 86400·d` | `base + 86400·d + 7200·(k+1)` | same instant (GPST; GAL uses GPST numerically) |
| BDS | `base + 14 + 86400·d` | `base + 86400·d + 7200·(k+1) + 14` | `slot − 14` → BDT-aligned 2 h epoch [CODE: PredictOrbClk case 2 `t − 0xE`] |
| GLO | `base + L + 86400·d` (L = `ctx+0xA8` leap seconds) | header: `base + L + 86400·d + 3600 + 7200·k` | 96 sub-blocks per day at `base + L + 86400·d + 900·n`, n=0…95. Header entry k covers sub-blocks 8k…8k+7 |

[CODE: FUN_001460ec `iVar4=(param_3/0x1c20)*0x1c20`, inner `iVar1=iVar10+0x1c20`; FUN_00146d3c `+0x1c2e`, `+0xe`; FUN_00147880 `iStack_96c=(uVar6&0xff)+…`, `aiStack_460[3k]=iVar3+0xe10+((n-1)>>3)*0x1c20`, `iVar7 += 900`, loop `!= 0x61`]

`eph.log` confirms this: t0=1476928054, base=1476921600, first GPS slot 1476928800, then every 7200 s, 36 slots; BDS slot 1476928814.

### 2.4 How each record is made (the same for GPS/QZS/GAL/BDS)
[CODE: FUN_00136260@00136260 and its siblings; PredictOrbClk FUN_00138ee0; FitBceOrbit16 FUN_001393e8]
1. `PredictOrbClk(t_slot, span=0x3840=14400 s, step=300 s)` evaluates the seed's per-satellite orbit model at **49 epochs over toe ± 2 h**. It converts each epoch to constellation time: GPS/GAL/QZS unchanged; BDS `t−14`; GLO `t−L+10800`. The middle epoch (index 24, at `+0x860` in the 0x10F0-byte per-satellite buffer) becomes **toe/toc**.
2. `FitBceOrbit16` runs a least-squares fit of the 16 Keplerian broadcast elements to those positions: at most 12 iterations, convergence `< 0.001`, reject if sigma `> 1.0` or `sqrtA < 0` [CODE: DAT_00118c90=0.001].
3. Clock: `af0 = a0 + a1·dt + 0.5·a2·dt²` (dt = toe − session toc), `af1 = a1`, `af2 = a2`, all from the seed session. TGD comes from the satellite header in the seed [CODE: FUN_00136260 lines computing `local_128`; `local_110` ← predict buffer +0x10].
4. Range check, then pack the record. Range-check failure means the satellite is dropped from that slot, logged as "Svid %u eph data overflow".

So the files contain **ICD-style broadcast ephemerides, one set per satellite per 2 h slot, valid ±2 h around toe**, fitted to Huawei's long-arc orbit predictions.

Doubles are radians and the packers divide by π, so **angles on disk are in ICD semicircle units** [CODE: DAT_00118c50 = 3.141592653589793].

Double index map used by every packer (`p[]`, filled by FitBceOrbit16): 0 af0, 1 af1, 2 af2, 3 TGD, 5 √A, 6 e, 7 i0, 8 Ω0, 9 ω, 10 M0, 11 Δn, 12 Ω̇, 13 IDOT, 14 Cuc, 15 Cus, 16 Cic, 17 Cis, 18 Crc, 19 Crs. [CODE: index↔name taken from the range checker FUN_00134030 (names "deltaN", "omegaDot", "iDot", "cuc", "cus", "crc", "crs", "cic", "cis" at p[11..19]) and the per-record log formats FUN_00139954 / FUN_00139d5c / FUN_0013a154 / FUN_0013acc4.]

---

## 3. Record layouts

### 3.1 GPS record, 80 bytes
[CODE: pack FUN_00139744@00139744; field names from log format in FUN_00139954@00139954 "Eph:svid:%u, week_number:%u, ura:%u, iode:%u, m0:%d, …, ure:%u"; range check FUN_00134030@00134030]

| off | size | type | field | value / scale (stored = round-toward-zero(value × scale)) |
|---|---|---|---|---|
| 0x00 | 1 | u8 | svid | PRN − 1 (0-based) |
| 0x01 | 1 | — | pad | 0 |
| 0x02 | 2 | u16 | week_number | `toe_gpst / 604800`: **full GPS week, not mod 1024** |
| 0x04 | 1 | u8 | ura | always 0 |
| 0x05 | 1 | — | pad | 0 |
| 0x06 | 2 | u16 | iode | always 0 |
| 0x08 | 4 | s32 | m0 | M0 [rad] × 2^31/π |
| 0x0C | 2 | s16 | delta_n | Δn [rad/s] × 2^43/π (checked in s16) |
| 0x0E | 2 | — | pad | 0 |
| 0x10 | 4 | u32 | ecc | e × 2^33 |
| 0x14 | 4 | u32 | sqrt_a | √A [√m] × 2^19 |
| 0x18 | 4 | s32 | omega_0 | Ω0 × 2^31/π |
| 0x1C | 4 | s32 | i0 | i0 × 2^31/π |
| 0x20 | 4 | s32 | omega | ω × 2^31/π |
| 0x24 | 4 | s32 | omega_dot | Ω̇ × 2^43/π (checked in 24-bit signed) |
| 0x28 | 2 | s16 | i_dot | IDOT × 2^43/π (checked in 14-bit signed) |
| 0x2A | 2 | s16 | cuc | × 2^29 |
| 0x2C | 2 | s16 | cus | × 2^29 |
| 0x2E | 2 | s16 | crc | × 2^5 |
| 0x30 | 2 | s16 | crs | × 2^5 |
| 0x32 | 2 | s16 | cic | × 2^29 |
| 0x34 | 2 | s16 | cis | × 2^29 |
| 0x36 | 1 | s8 | group_delay | TGD [s] × 2^31 |
| 0x37 | 1 | — | pad | 0 |
| 0x38 | 4 | s32 | af0 | × 2^31 |
| 0x3C | 4 | s32 | af1 | × 2^43 |
| 0x40 | 4 | s32 | af2 | × 2^55 |
| 0x44 | 2 | u16 | aodc | always 0 |
| 0x46 | 1 | u8 | health | always 0 |
| 0x47 | 1 | — | pad | 0 |
| 0x48 | 2 | u16 | toc | `(toe_gpst mod 604800) >> 4` (16 s units) |
| 0x4A | 2 | u16 | toe | same value as toc |
| 0x4C | 1 | s8 | fit_interval_flag | always 0 |
| 0x4D | 1 | u8 | aodo | always 0xFF |
| 0x4E | 1 | u8 | ure | always 0 |
| 0x4F | 1 | — | pad | 0 |

Range checks (record dropped if they fail) [CODE: FUN_00134030]: Δn, Cuc, Cus, Crc, Crs, Cic, Cis must fit s16; Ω̇ must fit [−2^23, 2^23−1]; IDOT must fit [−8192, 8191]. Other fields are not checked: values are simply truncated by the C cast.

### 3.2 QZSS record, 76 bytes
[CODE: pack FUN_00139b54@00139b54; names from FUN_00139d5c@00139d5c "Eph:satId:%u, health:%u, iod:%u, toc:%u, af2:%d, af1:%d, af0:%d, tgd:%d, urai:%u, fitFlag:%u, toe:%u, w:%d, …"; range check FUN_00134030]

| off | size | type | field | scale |
|---|---|---|---|---|
| 0x00 | 1 | u8 | satId | seed svid − 1 [INFERENCE: 0 = PRN 193] |
| 0x01 | 1 | u8 | health | 0 |
| 0x02 | 2 | u16 | iod | 0 (not set) |
| 0x04 | 2 | u16 | toc | `(t mod 604800) >> 4` |
| 0x06 | 2 | — | pad | |
| 0x08 | 4 | s32 | af2 | × 2^55 |
| 0x0C | 4 | s32 | af1 | × 2^43 |
| 0x10 | 4 | s32 | af0 | × 2^31 |
| 0x14 | 1 | s8 | tgd | × 2^31 |
| 0x15 | 1 | u8 | urai | 0 |
| 0x16 | 1 | u8 | fitFlag | 0 |
| 0x17 | 1 | — | pad | |
| 0x18 | 2 | u16 | toe | `(t mod 604800) >> 4` |
| 0x1A | 2 | — | pad | |
| 0x1C | 4 | s32 | w (ω) | × 2^31/π |
| 0x20 | 2 | s16 | deltaN | × 2^43/π |
| 0x22 | 2 | — | pad | |
| 0x24 | 4 | s32 | m0 | × 2^31/π |
| 0x28 | 4 | s32 | omegaDot | × 2^43/π |
| 0x2C | 4 | u32 | e | × 2^33 |
| 0x30 | 2 | s16 | idot | × 2^43/π |
| 0x32 | 2 | — | pad | |
| 0x34 | 4 | u32 | sqrtA | × 2^19 |
| 0x38 | 4 | s32 | I0 | × 2^31/π |
| 0x3C | 4 | s32 | OmegaA0 | × 2^31/π |
| 0x40 | 2 | s16 | crs | × 2^5 |
| 0x42 | 2 | s16 | cis | × 2^29 |
| 0x44 | 2 | s16 | cus | × 2^29 |
| 0x46 | 2 | s16 | crc | × 2^5 |
| 0x48 | 2 | s16 | cic | × 2^29 |
| 0x4A | 2 | s16 | cuc | × 2^29 |

There is no week field. In `eph.log` many QZS records are dropped because `crs`/`crc` overflow s16. This is expected for the IGSO/QZO orbits with the GPS scale of 2^-5 [CODE: range check; log lines "crs is invalid, value is 44374"].

### 3.3 Galileo record, 76 bytes
[CODE: pack FUN_00139f2c@00139f2c; names from FUN_0013a154@0013a154 "Eph:satId:%u, health:%u, iod:%u, toc:%u, af2:%d, af1:%d, af0:%d, tgd:%d, toe:%u, w:%d, …"; range check FUN_00134030]

| off | size | type | field | scale |
|---|---|---|---|---|
| 0x00 | 1 | u8 | satId | svid − 1 |
| 0x01 | 1 | u8 | health | 0 |
| 0x02 | 2 | u16 | iod | 0 (not set) |
| 0x04 | 4 | u32 | toc | `(t mod 604800) / 60` |
| 0x08 | 4 | s32 | af2 | × 2^59 |
| 0x0C | 4 | s32 | af1 | × 2^46 |
| 0x10 | 4 | s32 | af0 | × 2^34 |
| 0x14 | 2 | s16 | tgd (BGD) | × 2^32 |
| 0x16 | 2 | — | pad | |
| 0x18 | 4 | u32 | toe | `(t mod 604800) / 60` |
| 0x1C … 0x4B | | | w, deltaN, m0, omegaDot, e, idot, sqrtA, I0, OmegaA0, crs, cis, cus, crc, cic, cuc | **same offsets, types and scales as QZSS 0x1C–0x4B** (2^31/π, 2^43/π, 2^33, 2^19, 2^5, 2^29) |

There is no week field. t is GPST used as Galileo time, with no conversion [CODE: PredictOrbClk case 3].

### 3.4 BeiDou record, 92 bytes
[CODE: pack FUN_0013aa90@0013aa90; names from FUN_0013acc4@0013acc4 "Eph:svid:%u, health:%u, iod:%u, aodc:%u, toc:%u, a0:%d, a1:%d, a2:%d, tgd:%d, aode:%u, ura:%u, toe:%u, sqrtA:%u, …"; range check FUN_0013a304@0013a304]

| off | size | type | field | scale |
|---|---|---|---|---|
| 0x00 | 1 | u8 | svid | PRN − 1 |
| 0x01 | 1 | u8 | health | 0 |
| 0x02 | 2 | u16 | iod | `((t_bdt mod 604800) >> 3) & 0xFFC0` |
| 0x04 | 1 | u8 | aodc | 0 |
| 0x05 | 3 | — | pad | |
| 0x08 | 4 | u32 | toc | `(t_bdt mod 604800) >> 3` (8 s units) |
| 0x0C | 4 | s32 | a0 | × 2^33 |
| 0x10 | 4 | s32 | a1 | × 2^50 |
| 0x14 | 2 | s16 | a2 | × 2^66 |
| 0x16 | 2 | s16 | tgd | TGD1 [s] × 1e10 (0.1 ns) [CODE: DAT_00118c98 = 1e10] |
| 0x18 | 1 | u8 | aode | 0 |
| 0x19 | 1 | u8 | ura | 0 |
| 0x1A | 2 | — | pad | |
| 0x1C | 4 | u32 | toe | same as toc |
| 0x20 | 4 | u32 | sqrtA | × 2^19 |
| 0x24 | 4 | u32 | e | × 2^33 |
| 0x28 | 4 | s32 | w | × 2^31/π |
| 0x2C | 2 | s16 | deltaN | × 2^43/π (× 2^42/π when `param_6&1`. That case is the RSMC path. Wear always passes 0) |
| 0x2E | 2 | — | pad | |
| 0x30 | 4 | s32 | m0 | × 2^31/π |
| 0x34 | 4 | s32 | omega0 | × 2^31/π |
| 0x38 | 4 | s32 | omegaDot | × 2^43/π |
| 0x3C | 4 | s32 | i0 | × 2^31/π |
| 0x40 | 2 | s16 | iDot | × 2^43/π |
| 0x42 | 2 | — | pad | |
| 0x44 | 4 | s32 | cuc | × 2^31 |
| 0x48 | 4 | s32 | cus | × 2^31 |
| 0x4C | 4 | s32 | crc | × 2^6 |
| 0x50 | 4 | s32 | crs | × 2^6 |
| 0x54 | 4 | s32 | cic | × 2^31 |
| 0x58 | 4 | s32 | cis | × 2^31 |

Range check [CODE: FUN_0013a304]: Δn must fit s16; Ω̇ must fit 24-bit; IDOT must fit 14-bit; Cuc, Cus, Crc, Crs, Cic, Cis must fit **18-bit** [−131072, 131071]. These are BDS ICD widths, although the stored type is s32. `eph.log` shows C03/C04 (GEO) dropped by "deltaN is invalid". There is no week field.

### 3.5 GLONASS record, 52 bytes (24 per 1252-byte sub-block)
[CODE: pack FUN_0013b4ac@0013b4ac; names from FUN_0013b754@0013b754 "Eph:satId:%u, health:%u, iod:%u, tau:%d, gamma:%d, deltaTau:%u, en:%u, p1:%u, p2:%u, m:%u, x:%d, xDot:%d, xDotDot:%d, …"; builder FUN_00137ed0@00137ed0; state propagation FUN_0013b03c; acceleration lookup FUN_0013b3ac]

| off | size | type | field | scale |
|---|---|---|---|---|
| 0x00 | 1 | u8 | satId | slot number − 1 |
| 0x01 | 1 | u8 | health | 0 |
| 0x02 | 2 | u16 | iod (= tb index) | `(t_glo mod 86400) / 900`, where t_glo = GLONASS time (UTC+3 h) of the 900 s-aligned epoch |
| 0x04 | 4 | s32 | tau | −(a0 + a1·dt + a2·dt²) [s] × 2^30 |
| 0x08 | 2 | s16 | gamma | (a1 / 3600) × 2^40 [INFERENCE: the seed a1 is per hour for GLO] |
| 0x0A | 1 | s8 | deltaTau | 0 |
| 0x0B | 1 | u8 | en | 0 |
| 0x0C | 1 | u8 | p1 | **1** |
| 0x0D | 1 | u8 | p2 | 0 |
| 0x0E | 1 | u8 | m | 0 |
| 0x0F | 1 | — | pad | |
| 0x10 | 4 | s32 | x | X [m] / 1000 × 2^11 (km, 2^-11) |
| 0x14 | 4 | s32 | xDot | Ẋ [m/s] / 1000 × 2^20 |
| 0x18 | 1 | s8 | xDotDot | Ẍ (lunisolar, from `gloAcc`) × 2^30 (km/s²) |
| 0x19 | 3 | — | pad | |
| 0x1C | 4 | s32 | y | as x |
| 0x20 | 4 | s32 | yDot | as xDot |
| 0x24 | 1 | s8 | yDotDot | as xDotDot |
| 0x25 | 3 | — | pad | |
| 0x28 | 4 | s32 | z | as x |
| 0x2C | 4 | s32 | zDot | as xDot |
| 0x30 | 1 | s8 | zDotDot | as xDotDot |
| 0x31 | 3 | — | pad | |

Each GLO record is an ICD-style state vector at a 15-min epoch. One sub-block holds all satellites for one epoch. One header entry covers 8 epochs (2 h).

Leap seconds `L` = `ctx+0xA8` (set only by `GetSeedInfo` from the seed `seedInfo`) is used three times: to shift the seed's toe (`FUN_00138868`, when constel == 1), to shift the query time, and in the GPS→GLO conversion. **`GetSeedInfo` runs after the GLO generation (inside `GenerateAssistData`). So on the first run in a process L = 0.** [CODE: FUN_0013218c only called from FUN_0013215c ← FUN_001453b0.] [INFERENCE: the L terms cancel in `t − toeS`, so the state is the same. The 900 s epochs and the header times are then simply 18 s earlier in GPS seconds.]

---

## 4. `HW_PGNSS_EXTRA`

[CODE: GenerateAssistData FUN_001453b0@001453b0]

Each section is a fixed-size native struct. It is zero-filled first, then filled by the bit decoder. If a section is missing or fails to decode it is still written, as zeros ("GetXxx error" is only logged). The first section is written with `"wb"` (truncate) and the rest with `"ab"`. There are no tags, IDs, lengths, magic or checksum. **Total size is always 6248 bytes. The file is never gzipped.**

| # | file offset | size | section | JSON key | struct builder |
|---|---|---|---|---|---|
| 1 | 0 | 16 (0x10) | GPS UTC | `gpsUtc` | FUN_001422f0 → FUN_00142100 |
| 2 | 16 | 8 | GPS ION (Klobuchar) | `gpsIon` | FUN_001426e0 → FUN_001424f0 |
| 3 | 24 | 264 (0x108) | GLO AUX | `gloAux` | FUN_00142ac0 → FUN_001428e0 |
| 4 | 288 | 280 (0x118) | GPS RTI | `gpsRti` | FUN_001419bc → FUN_0014178c |
| 5 | 568 | 264 (0x108) | GLO RTI | `gloRti` | FUN_00141d6c(1) → FUN_00141bbc |
| 6 | 832 | 264 | GAL RTI | `galRti` | FUN_00141d6c(3) |
| 7 | 1096 | 264 | BDS RTI | `bdsRti` | FUN_00141d6c(2) |
| 8 | 1360 | 1028 (0x404) | GPS ALM | `gpsAlm` | FUN_001405d4 → FUN_001402e8 |
| 9 | 2388 | 772 (0x304) | GLO ALM | `gloAlm` | FUN_00140b0c → FUN_001407d4 |
| 10 | 3160 | 800 (0x320) | GAL ALM | `galAlm` | FUN_0014106c → FUN_00140d0c |
| 11 | 3960 | 2272 (0x8E0) | BDS ALM | `bdsAlm` | FUN_0014158c → FUN_0014126c |
| 12 | 6232 | 16 | seed trailer | (`seedInfo`) | FUN_0013215c → `ctx+0x9C..0xAB` |

The wire (seed) payloads are base64 of a big-endian, MSB-first bitstream. Bit fields are read by `LoadBits(r,&v,unsigned?,n)`; flag 0 means signed and sign-extended [CODE: FUN_00131654@00131654]. Field names below are **[INFERENCE]** from ICD order and signedness. The widths, offsets and signedness are [CODE].

**1. GPS UTC (16 B).** Wire = exactly 20 bytes: s32, s32, then six 16-bit fields. Struct: +0 s32, +4 s32, +8 u8 (low byte of u16), +9 u8, +0xA s8, +0xB u8, +0xC s8, +0xD u8, +0xE..F zero. The 16-bit wire fields are **truncated to 8 bits**. [INFERENCE: A0/A1, tot, WNt, ΔtLS, WNLSF, DN/ΔtLSF.] `eph.log`: base64 → 20 bytes.

**2. GPS ION (8 B).** Wire = exactly 8 bytes, each s8: α0, α1, α2, α3, β0, β1, β2, β3 [INFERENCE: ICD Klobuchar raw integers].

**3. GLO AUX (264 B).** Struct +0 u32 = 1 (constant), +4 u8 n (wire length must be 3n+1). Entry i at **+5+4i**: +0 u8 (slot), +1 u8 (third wire byte), +2 u8 = 1 (constant valid flag), +3 s8 (second wire byte, signed: [INFERENCE] frequency channel k). Room for 64 entries; `eph.log` has n=24.

**4. GPS RTI (280 B).** Wire header: u16 + s64, **both read and discarded**, then u8 n (length must be 7n+11). Struct +0..+0xF zero, +0x10 u8 n (≤32). Entry i at **+0x12+8i** (wire 7 bytes): +0 u8, +1 u8, +2 u16, +4 u16, +6 u8. [INFERENCE: svid + real-time integrity flags/times.] Confirmed in the disassembly at 0x417e4–0x41828 that the 16/64-bit header values are not stored.

**5–7. GLO/GAL/BDS RTI (264 B each).** +0 u32 constel (1 = GLO, 3 = GAL, 2 = BDS) [CODE: FUN_00141d6c `*param_3 = param_2`], +4 u8 n (length must be 3n+1). Entry i at **+6+4i**: +0 u8 svid, +2 u16. Room for 64.

**8. GPS ALM (1028 B = 4 + 32×32).** Wire: u16 (stored as u8 **truncated**) at +0, u8 n at +1 (≤32; length must be 31n+3); +2..3 zero. Entry i at **+4+32i** (wire 31 bytes):

| e+ | type | wire bits | [INFERENCE] name |
|---|---|---|---|
| 0x00 | u8 | u8 | svid |
| 0x02 | u16 | u16 | e |
| 0x04 | u8 | u16→u8 | toa |
| 0x06 | s16 | s16 | δi |
| 0x08 | s16 | s16 | Ω̇ |
| 0x0A | u8 | u16→u8 | health |
| 0x0C | u32 | u32 | √A |
| 0x10 | s32 | s32 | Ω0 |
| 0x14 | s32 | s32 | ω |
| 0x18 | s32 | s32 | M0 |
| 0x1C | s16 | s16 | af0 |
| 0x1E | s16 | s16 | af1 |

**9. GLO ALM (772 B = 4 + 24×32).** Wire header 4×u8 → +0 n (≤24; length must be 29n+4), +1, +2, +3. Entry i at **+4+32i**, packed and unaligned (wire 29 bytes): +0x00 u16, +0x02 u8, +0x03 u8, +0x04 s32, +0x08 u32, +0x0C s32, +0x10 s32, +0x14 s8, +0x16 u16, **+0x1A s16 written twice** (two consecutive wire s16 fields are both stored at e+0x1A, so the first is lost and e+0x18 stays 0), +0x1C u8, +0x1D u8 [CODE: objdump 0x409e4 and 0x40a00 both `sturh w8,[x22,#-0x3]`].

**10. GAL ALM (800 B = 8 + 36×22).** Wire header u8 n, u32 T, u8 X (length must be 21n+6). Struct: +0 n (≤36); +1 u8 = (T/604800) & 0xFF; let `tow = T mod 604800`: if `tow>>11 < 75` then +2 = 0, +4 u16 = 0, +6 u8 = tow/600; else +2 = 1, +4 u16 = tow/600, +6 = 0; +7 u8 = X. Entry i at **+8+22i**: +0 u8 svid, +2 u16, +4 s16, +6 s16, +8 u8, +9 u8, +0xA s16, +0xC s16, +0xE s16, +0x10 s16, +0x12 s16, +0x14 s16 [CODE: FUN_00140d0c@00140d0c]. [INFERENCE: ICD order svid, e, Δ√A, δi, E5b/E1B health, ω, Ω0, Ω̇, M0, af0, af1.]

**11. BDS ALM (2272 B = 4 + 63×36).** Wire header 4×u8 → +0 n (≤63; length must be 34n+4), +1, +2, +3. Entry i at **+4+36i**: +0 u8, +1 u8, +4 u32, +8 u32, +0xC s32, +0x10 s32, +0x14 s32, +0x18 s32, +0x1C s16, +0x1E s16, +0x20 s16, +0x22 u16 [CODE: FUN_0014126c@0014126c].

**12. Seed trailer (16 B)** = raw copy of `ctx+0x9C`:

| off | type | meaning |
|---|---|---|
| +0 | u32 | seed start, GPS s (seedInfo bytes 0–3, **big-endian on the wire**, stored LE) |
| +4 | u32 | seed end, GPS s (seedInfo bytes 4–7) |
| +8 | u32 | `ctx+0xA4`: last GPS slot time written by GenerateGpsEph (FUN_00131fe0). **Reset to 0 by GetSeedInfo when the seed start changed**, which is always the case on the first run in a process |
| +12 | u8 | leap seconds (seedInfo byte 8) |
| +13..15 | — | `ctx+0xA9..0xAB` [INFERENCE: padding, 0] |

If `GetSeedInfo` fails, +0..+12 are zeroed [CODE: FUN_0013215c]. `eph.log`: `GetSeedInfo: 1476910800 : 1477515600 : 18`, which is 7 days, leap 18.

---

## 5. Input side (seed) in brief

- **Container**: downloaded JSON `{… "HiEE":[{"seedInfo":"<b64>"},{"gpsNav":"<b64>"},…]}`. Each value is located with `strstr("\"key\":\"")` and ends at the next `"},{` or `"}]` [CODE: FUN_00140094@00140094 terminators 0x7b2c7d22 `"},{` and `"}]`]. Keys: `seedInfo`, `gpsNav`, `galNav`, `bdsNav`, `gloNav`, `gloAcc`, `qzsNav`, `gpsUtc`, `gpsIon`, `gloAux`, `gpsRti`, `gloRti`, `galRti`, `bdsRti`, `gpsAlm`, `gloAlm`, `galAlm`, `bdsAlm`.
- **seedInfo** (`GetSeedInfo` FUN_0013218c@0013218c): base64 of at most 30 chars (20 in the log, about 15 bytes). Big-endian u32 start, big-endian u32 end, u8 leap seconds. The remaining bytes are unused.
- **`*Nav` bitstream** (`DecodeGnssBit` FUN_00135768, MSB-first):
  - `u8 nSat`. Maximum per constellation: GPS 32, GLO 24, BDS 63, GAL 36, QZS 10 [CODE: table DAT_00118dc8].
  - Per satellite, a **120-bit header** [CODE: FUN_0013866c@0013866c]: u8 svid, u6 secNum, u2 fitType, u8 (?), s16 ×2^-32 (used as TGD), s16 ×2^-32, s16 ×2^-32, u16 ×2^-32, u32 (skipped).
  - Then `secNum` × **1729-bit section** [CODE: FUN_00138868@00138868]: u13 week, u8 health, u16 toeStart×16 s (+L for GLO), u16 toeEnd×16 s, s31 a0 ×2^-34 s, s25 a1 ×2^-50, then **X, Y, Z: 20 Chebyshev coefficients each**, signed, widths `38,38,37,37,36,34,33,32,30,29,27,25,23,22,20,19,17,16,14,13` (DAT_00118ccc), scale 2^-10 [INFERENCE: metres, ECEF; "GetWEarth" exists for the fit].
  - **Check**: 29 GPS satellites × (120 + 14·1729) + 8 bits = 705 462 bits = 88 183 bytes, which equals the logged "base64 decode 88183". 17 GAL satellites give 51 694, which equals the log.
- **Fit session** = one 12 h Chebyshev arc. Time is mapped as τ = 2(t−toeS)/(toeE−toeS) − 1, and the velocity/acceleration factor is hard-coded to 43200 s [CODE: FUN_0013b03c@0013b03c]. 14 sections = 7 days per satellite. For each generated day the decoder keeps 3 sessions: "fit 0" (start ≤ t < start+12 h), "fit 1" (start in (t, t+12 h]) and "fit 2" (start in (t+12 h, t+24 h]). That covers 36 h [CODE: FUN_00138a94@00138a94]. `GetEphFitSessionId` picks the session containing the epoch, and skips unhealthy ones except svid 59–63 [CODE: FUN_0013ae88].
- **gloAcc** (FUN_001381ec): per satellite u8 slot, then N samples (672 = 7 d × 96) of X, Y, Z lunisolar accelerations as **s5 × 2^-30** km/s². This is the source of `x/y/zDotDot`.
- **Generation window**: 3 days (mode 0) or 7 days (SEVEN) from `floor(now/7200)·7200`. 12 slots per day, 2 h apart. Each slot is fitted over toe ± 2 h at 300 s steps. GLONASS uses 96 states per day, 15 min apart.

**Can public data feed a generator?** The output contains nothing specific to Huawei. It holds ICD-style broadcast Keplerian sets (GPS/QZS/GAL/BDS) and ICD-style GLONASS state vectors, one per 2 h slot (GLO: per 15 min), plus raw almanac/UTC/ION/RTI structs. Huawei's own pipeline is: long-arc orbit (Chebyshev seed) → sample ±2 h → least-squares fit of broadcast elements. A generator could do the same from IGS ultra-rapid predicted SP3 (or any orbit propagator), or for near-term slots could copy real broadcast ephemerides from RINEX nav (BRDC) after re-scaling. The almanac, UTC, ION and GLO frequency channels are all in public RINEX/almanac files.

---

## 6. Integrity / validation fields

- **None in any file**: no magic, version, length prefix, CRC or checksum in the five ephemeris files or in EXTRA [CODE: the writers above only write header + blocks, or the 12 raw structs].
- The only structural invariants are: header offsets/sizes match the fixed block sizes; `count` ≤ capacity; the first block is at 0x3F0; EXTRA is exactly 6248 bytes.
- **SEVEN mode only**: the gzip container carries the standard gzip CRC-32 and ISIZE trailer, from zlib `gzwrite` at level 9. The file name stays unchanged.
- Fields Huawei always leaves at fixed values (a generator should copy them): GPS ura/iode/aodc/health/fit/ure = 0 and aodo = 0xFF; QZS/GAL/BDS iod/health/ura/aode = 0 (BDS iod = toc-derived); GLO health/en/p2/m/deltaTau = 0 and p1 = 1.
- What the watch checks is not visible in this library.

---

## 7. Open questions

1. **What the watch validates.** Does it check header times against its clock? Does it reject zero iode/ura? Does it need GPS `aodo = 0xFF`? This cannot be seen from the phone side. The next step is to capture the transfer (`btsnoop_hci.log`) and compare the bytes with these tables.
2. **How the five files plus EXTRA are framed on the BLE transfer** (file IDs, names on the wire). That is outside `libPgnssJni.so` and lives in the Java transfer layer.
3. **The EXTRA field semantics** (ALM/RTI/AUX names) are inferred from ICD order and signedness. Several 16-bit wire fields are truncated to u8, and the GLO ALM has one field lost to a double store at e+0x1A. It is unclear whether the watch depends on those bytes.
4. **Seed frame and units** of the Chebyshev coefficients: assumed ECEF metres from the GLO km conversion and from `GetWEarth`. This does not affect the output format.
5. **GLO `gamma`** = a1/3600 × 2^40: whether the seed's GLO a1 is really per hour, or this is a Huawei quirk.
6. **seedInfo bytes 9–14** and the satellite-header fields that are not used (the second to fourth s16/u16 and the u32): their meaning is unknown.
7. **ctx+0xA9..0xAB** in the EXTRA trailer: assumed padding.
8. **RSMC path** (`RSMC_PGNSS_GPS/BDS`, `decodeRsmcEphSeeds`, FUN_001378e4/FUN_00134cf0, BDS Δn scale 2^42/π): not analysed. It is not used for `HW_PGNSS_PRED`.

---

## 8. Validation against a real transfer (Fit 4 Pro, 2026-10-25 08:47 WIB)

Source: `btsnoop_hci.log` from `bugreport.zip` (Xiaomi 2506BPN68G, Android 16), HH 17.0.8.300 paired to the owner's Watch Fit 4 Pro over BR/EDR RFCOMM (DLCI 33). Payloads are link-encrypted (`7C 01 01 | 7D 10 <iv> | 7E <len> <ct>`); headers (service/command) and lengths are plain. Each `1C/05` chunk carries 17 bytes of fixed overhead after the 24-byte crypto header (16 when the chunk's length varint is one byte shorter).

| Order pulled | 1C/05 chunks | Encrypted bytes | Minus 17/chunk | Predicted by §2–4 (3-day mode) | File |
|---|---|---|---|---|---|
| 1 | 109 | 95 165 | 93 312 | 1008 + 36 × 2564 = 93 312 | `HW_PGNSS_GPS` |
| 2 | 244 | 213 956 | 209 808 | 1008 + 36 × 5800 = 209 808 | `HW_PGNSS_BDS` |
| 3 | 420 | 368 724 | 361 584 | 1008 + 288 × 1252 = 361 584 | `HW_PGNSS_GLONASS` |
| 4 | 116 | 101 620 | 99 648 | 1008 + 36 × 2740 = 99 648 | `HW_PGNSS_GALILEO` |
| 5 | 34 | 29 089 | 28 511 | 1008 + 36 × 764 = 28 512 (last chunk 16) | `HW_PGNSS_QZS` |
| 6 | 8 | 6 384 | 6 248 | 6 248 | `HW_PGNSS_EXTRA` |

Every size is exact, so on this watch the files go over the link uncompressed, in 3-day mode, with the layouts above. The file-name mapping is by size (the names themselves are inside the encrypted `1C/01` answer, 128 bytes for six names).

Same session, the `HW_AGNSS` request (`1F/02` answer 87 bytes = the 38-char tag `higeo/v1/gnssinfo?type=0x0024/HW_AGNSS`, the same length JoyoFit logged for it): one file, 9 chunks, 7 589 encrypted bytes → **7 436 bytes** of `HW_AGNSS_RTCM_33`. HH writes the server's gunzipped answer unchanged under that name (`gty.e`, jadx classes31). That is the size range of `scripts/agps-rtcm.ts` output (7 839 bytes for 120 satellites on 2026-10-21).

A third request at 08:47:41 (`1F/02` answer 106 bytes, so a ~57-char tag) ended with HH sending `1F/03` state 4 (failed) and no file transfer. [INFERENCE: `HW_PRECSION_ION`, which needs an authorised Huawei request carrying latitude and longitude.]

So open question 2 is answered: six files, one `1C/01`…`1C/06` cycle each, names as in §1. Open question 1 (what the watch validates) is still open, because the plaintext bytes were never seen.
