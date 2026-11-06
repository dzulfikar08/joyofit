// DevEco-style signing material for hvigor (watch-app/navi/tools/build-signed.sh). hvigor only accepts keystore passwords
// encrypted with AES-128-GCM under a work key that is itself encrypted with a root key derived from <keystore dir>/material
// (fd/, ac/, ce/), the format of hvigor-ohos-plugin src/utils/decipher-util.js. Creates material/ on first use and prints
// the encrypted password as hex.
//   node signing-material.cjs <keystore dir> <file with the plain password>
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const [dir, pwFile] = process.argv.slice(2);
const pw = fs.readFileSync(pwFile, 'utf8');
const component = Buffer.from(new Int8Array([49,243,9,115,214,175,91,184,211,190,177,88,101,131,192,119]).buffer);
const m = path.join(dir, 'material');
if (!fs.existsSync(m)) {
  const w = (p, b) => { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, b, { mode: 0o600 }); };
  for (let i = 0; i < 3; i++) w(path.join(m, 'fd', String(i), crypto.randomBytes(8).toString('hex')), crypto.randomBytes(16));
  w(path.join(m, 'ac', crypto.randomBytes(8).toString('hex')), crypto.randomBytes(16));
  const rootKey = deriveRoot();
  w(path.join(m, 'ce', crypto.randomBytes(8).toString('hex')), enc(rootKey, crypto.randomBytes(16)));
}
function one(d) { const f = fs.readdirSync(d); return fs.readFileSync(path.join(d, f[0])); }
function deriveRoot() {
  const fd = fs.readdirSync(path.join(m, 'fd')).map(s => one(path.join(m, 'fd', s)));
  const parts = fd.concat([component]);
  let x = Buffer.from(parts[0]);
  for (let i = 1; i < parts.length; i++) x = Buffer.from(x.map((b, k) => b ^ parts[i][k]));
  const salt = Buffer.from(new Int8Array(one(path.join(m, 'ac'))).buffer);
  return crypto.pbkdf2Sync(x.toString(), salt, 1e4, 16, 'sha256');
}
function enc(key, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-128-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  return Buffer.concat([len, iv, body]);
}
function dec(key, r) {
  const e = r.readUInt32BE(0), i = r.length - 4 - e, iv = r.subarray(4, 4 + i);
  const d = crypto.createDecipheriv('aes-128-gcm', key, iv); d.setAuthTag(r.subarray(r.length - 16));
  return Buffer.concat([d.update(r.subarray(4 + i, r.length - 16)), d.final()]);
}
const workKey = dec(deriveRoot(), one(path.join(m, 'ce')));
process.stdout.write(enc(workKey, Buffer.from(pw, 'utf8')).toString('hex'));
