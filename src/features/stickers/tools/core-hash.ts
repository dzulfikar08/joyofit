// Refreshes core.sha256 after an intentional change to core/.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { coreHash } from "../core-hash";

const hash = coreHash(join(import.meta.dir, "../core"));
writeFileSync(join(import.meta.dir, "../core.sha256"), `${hash}\n`);
console.log(hash);
