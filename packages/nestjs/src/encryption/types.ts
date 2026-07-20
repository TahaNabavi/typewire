/**
 * Key material shapes — identical to the typefetch client's
 * `encryptionMiddleware`, so the same `keyProvider` works on both ends.
 */
export type SymmetricKeyMaterial = {
  type: "symmetric";
  key: string;
};

export type RSAKeyMaterial = {
  type: "rsa";
  publicKey: string;
  privateKey: string;
};

export type KeyMaterial = SymmetricKeyMaterial | RSAKeyMaterial;

/** Handlers for `method: "Custom"` — must match the client's implementation. */
export type CustomEncryptionHandlers = {
  encrypt: (value: string, key: KeyMaterial) => string | Promise<string>;
  decrypt: (value: string, key: KeyMaterial) => string | Promise<string>;
};

/**
 * Backend encryption config, provided globally via
 * `TypeFetchModule.forRoot({ encryption })`. The `keyProvider` mirrors the
 * one passed to the client's `encryptionMiddleware`.
 */
export interface BackendEncryptionOptions {
  /** Supplies key material (symmetric key, or RSA key pair). */
  keyProvider: () => KeyMaterial | Promise<KeyMaterial>;
  /** Handlers used when a contract selects `method: "Custom"`. */
  customHandlers?: CustomEncryptionHandlers;
  /**
   * `true` (default): throw when decryption/encryption fails, so plaintext is
   * never leaked and undecryptable input is rejected. `false`: log and fall
   * back to the original value.
   */
  failClosed?: boolean;
}
