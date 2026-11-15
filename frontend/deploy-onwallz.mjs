import { readFile } from "node:fs/promises";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { Contract } from "@aztec-labs/aztec.js/contracts";
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded";
import { loadContractArtifact } from "@aztec-labs/stdlib/abi";
import { INITIAL_TEST_SECRET_KEYS, INITIAL_TEST_ACCOUNT_SALTS, INITIAL_TEST_SIGNING_KEYS } from "@aztec-labs/accounts/testing";

const node = createAztecNodeClient("http://localhost:8080");
const wallet = await EmbeddedWallet.create(node);
const mgr = await wallet.createSchnorrInitializerlessAccount(
  INITIAL_TEST_SECRET_KEYS[0], INITIAL_TEST_ACCOUNT_SALTS[0], INITIAL_TEST_SIGNING_KEYS[0]);

const raw = await readFile("../target/onwallz_contract-OnWallz.json", "utf8");
const artifact = loadContractArtifact(JSON.parse(raw));
const d = await Contract.deploy(wallet, artifact, []).send({ from: mgr.address });
console.log("ADDRESS=" + (d.contract?.address ?? d.address).toString());
await wallet.stop();
