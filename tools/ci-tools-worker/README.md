# joyofit-ci-tools

A small Worker that hands build tools CI may not download from a public place to GitHub Actions. Today that is Huawei's
Command Line Tools for HarmonyOS, used by `.github/workflows/watch-app.yml` (docs/watch-app.md, "Building in CI").

- Bucket: R2 `joyofit-ci-tools` in Dzulfikar.at@gmail.com's Account, r2.dev access off. Nothing in it is public.
- Worker: `https://joyofit-ci-tools.dzulfikar-at.workers.dev/<object key>`, `Authorization: Bearer <CI_TOOLS_KEY>`.
  Wrong or missing key: 401. Unknown key: 404. GET only.
- Secret: `CI_TOOLS_KEY`, the same value as the `watch` environment secret of the same name on GitHub.

## Objects

| Key | What |
|---|---|
| `hmos-clt/6.0.1.251-linux-x64-lite.tar.zst` | `command-line-tools/` 6.0.1.251 (linux-x64), 149 MB. `sdk/default/{openharmony,hms}/{native,previewer}` keep only their top-level metadata files (hvigor checks the components exist; the lite build reads none of their contents). Checked 2026-11-12 against the full 6.3 GB install, and CI's build against a local one: the 52 resource files in the haptobin `.bin` are byte-identical, `app.js` and `index.js` are identical once webpack's module ids are renumbered (the ids come from the random temp build dir, so any two builds differ there), and only the signature trailer and source-map column offsets differ. SHA-256 `79616815afdd031d84ca739f7f69946415cd515f167e4fb606309b403ab17f30`. |

## Changing it

```bash
cd tools/ci-tools-worker
bunx wrangler deploy
openssl rand -hex 32 | tr -d '\n' > key && bunx wrangler secret put CI_TOOLS_KEY < key \
  && gh secret set CI_TOOLS_KEY --env watch < key; rm key       # rotate the key (both sides at once)

# A new toolkit: unpack Huawei's zip, empty the same native/ and previewer/ folders (keep their *.json and NOTICE.txt),
# then pack, upload, and update HMOS_CLT_OBJECT and HMOS_CLT_SHA256 in the workflow.
tar --sort=name --owner=0 --group=0 --numeric-owner -cf - command-line-tools | zstd -19 -T0 --long=27 -o clt.tar.zst
bunx wrangler r2 object put joyofit-ci-tools/hmos-clt/<version>-linux-x64-lite.tar.zst --file clt.tar.zst --remote
```

`wrangler r2 object put` takes files up to 300 MiB.
