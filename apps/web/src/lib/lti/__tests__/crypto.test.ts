import { generateKeyPairSync } from "node:crypto";
import { importJWK, jwtVerify } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { publicJwks, signLtiJwt } from "../crypto";

const previous = process.env.LTI_PRIVATE_JWK;
afterEach(() => { if (previous === undefined) delete process.env.LTI_PRIVATE_JWK; else process.env.LTI_PRIVATE_JWK = previous; });

describe("LTI signing", () => {
  it("signs with the configured private key and publishes no private parameters", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateJwk = { ...(privateKey.export({ format: "jwk" }) as JsonWebKey), alg: "RS256", kid: "test-key" };
    process.env.LTI_PRIVATE_JWK = JSON.stringify(privateJwk);
    const jwks = await publicJwks();
    expect(jwks.keys[0]).not.toHaveProperty("d");
    const token = await signLtiJwt({ hello: "world" }, "client-id", "canvas");
    const key = await importJWK(jwks.keys[0], "RS256");
    const verified = await jwtVerify(token, key, { issuer: "client-id", audience: "canvas" });
    expect(verified.payload.hello).toBe("world");
  });
});
