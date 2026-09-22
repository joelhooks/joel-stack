import { Schema } from "effect";

const Ed25519PrivateJwkSchema = Schema.Struct({
  alg: Schema.optional(Schema.String),
  crv: Schema.Literal("Ed25519"),
  d: Schema.String,
  kid: Schema.optional(Schema.String),
  kty: Schema.Literal("OKP"),
  x: Schema.String,
});

type Ed25519PrivateJwk = typeof Ed25519PrivateJwkSchema.Type;

export const decodeEd25519PrivateJwk = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Ed25519PrivateJwkSchema)
);

export const publicKeyDirectory = (privateJwk: Ed25519PrivateJwk) => ({
  keys: [
    {
      alg: "EdDSA",
      crv: privateJwk.crv,
      kid: privateJwk.kid ?? "ratstack-webbot-1",
      kty: privateJwk.kty,
      use: "sig",
      x: privateJwk.x,
    },
  ],
});
