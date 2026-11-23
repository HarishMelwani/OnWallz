/**
 * The in-app wallet's backup, kept apart from the wallet itself so the heavy PXE code
 * only loads when someone actually creates or imports a wallet.
 */
const STORAGE_KEY = "onwallz.inapp.v1";

export type InAppKeys = {
  v: 1;
  secret: string;
  salt: string;
  signingKey: string;
  address: string;
};

export function storedRaw(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function hasStoredWallet(): boolean {
  return storedRaw() !== null;
}

export function saveKeys(keys: InAppKeys): void {
  localStorage.setItem(STORAGE_KEY, btoa(JSON.stringify(keys)));
}

export function exportBackup(): string | null {
  const raw = storedRaw();
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(atob(raw)), null, 2);
  } catch {
    return null;
  }
}

export function forgetWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function parseBackup(backup: string): InAppKeys {
  const text = backup.trim();
  if (!text) throw new Error("paste your wallet backup first");
  let parsed: Partial<InAppKeys>;
  try {
    parsed = JSON.parse(text) as Partial<InAppKeys>;
  } catch {
    try {
      parsed = JSON.parse(atob(text)) as Partial<InAppKeys>;
    } catch {
      throw new Error("that does not look like an OnWallz wallet backup");
    }
  }
  if (parsed.v !== 1 || !parsed.secret || !parsed.salt || !parsed.signingKey) {
    throw new Error("that backup is missing keys");
  }
  return {
    v: 1,
    secret: parsed.secret,
    salt: parsed.salt,
    signingKey: parsed.signingKey,
    address: parsed.address ?? "",
  };
}
