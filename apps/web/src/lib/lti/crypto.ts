import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, importJWK, type JWK } from "jose";
import { ltiRuntimeRepo } from "@/lib/repo/ltiRuntimeRepo";

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

export function configuredPrivateJwk(): JWK {
  const raw = process.env.LTI_PRIVATE_JWK;
  if (!raw) throw new Error("LTI_PRIVATE_JWK is required");
  return JSON.parse(raw) as JWK;
}

export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const privateJwk = configuredPrivateJwk() as Record<string, unknown>;
  const privateParameters = new Set(["d", "p", "q", "dp", "dq", "qi", "oth"]);
  const publicJwk = Object.fromEntries(Object.entries(privateJwk).filter(([name]) => !privateParameters.has(name)));
  return {
    keys: [{
      ...publicJwk,
      kid: typeof privateJwk.kid === "string" ? privateJwk.kid : "oci-lti-1",
      alg: typeof privateJwk.alg === "string" ? privateJwk.alg : "RS256",
      use: "sig",
      key_ops: ["verify"],
    } as JWK],
  };
}

export async function signLtiJwt(payload: Record<string, unknown>, issuer: string, audience: string, lifetime = "5m") {
  const jwk = configuredPrivateJwk();
  const key = await importJWK(jwk, jwk.alg ?? "RS256");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: jwk.alg ?? "RS256", kid: jwk.kid ?? "oci-lti-1", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setJti(randomUUID()).setIssuedAt().setExpirationTime(lifetime).sign(key);
}

export async function createOneTimeToken(purpose: "state" | "nonce", targetLinkUri: string, deploymentId?: string) {
  const token = randomToken();
  await ltiRuntimeRepo.ltiOneTimeToken.create({
    data: { tokenHash: tokenHash(token), purpose, targetLinkUri, deploymentId, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return token;
}

export async function consumeOneTimeToken(token: string, purpose: "state" | "nonce") {
  const hash = tokenHash(token);
  const row = await ltiRuntimeRepo.ltiOneTimeToken.findUnique({ where: { tokenHash: hash }, include: { deployment: { include: { platform: true } } } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= new Date()) return null;
  const claimed = await ltiRuntimeRepo.ltiOneTimeToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? row : null;
}
