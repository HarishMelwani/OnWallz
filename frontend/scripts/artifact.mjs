/**
 * `aztec compile` emits a raw compilation artifact (`file_map`, numeric-keyed
 * functions). The wallet API validates a processed ContractArtifact, so any
 * unprocessed one is rejected with -32602 INVALID_PARAMS. Normalise it here,
 * once, at build time.
 */
import fs from "node:fs";
import path from "node:path";
import { loadContractArtifact } from "@aztec-labs/stdlib/abi";

const source = process.argv[2] ?? path.resolve(process.cwd(), "../target/walls_contract-Walls.json");
const target = process.argv[3] ?? path.resolve(process.cwd(), "src/artifacts/walls.json");

const raw = JSON.parse(fs.readFileSync(source, "utf8"));
const artifact = loadContractArtifact(raw);

fs.writeFileSync(target, JSON.stringify(artifact));
console.log(
  `wrote ${path.relative(process.cwd(), target)} — ${Object.keys(artifact.functions).length} functions, ${(fs.statSync(target).size / 1024).toFixed(0)} kB`,
);