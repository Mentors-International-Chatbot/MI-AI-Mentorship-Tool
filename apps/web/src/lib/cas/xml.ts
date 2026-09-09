/**
 * L1.c (Auth & Login Restructure). Narrow parser for CAS 2/3's
 * `serviceResponse` XML — not a general XML parser. CAS's success/failure
 * shapes are fixed and flat (no attribute nesting in practice), so a small
 * regex-based scan is enough and avoids pulling in a dependency for a
 * format this constrained, on a provider that ships disabled and untested
 * against a real server until BYU's CAS is confirmed.
 *
 * Success (CAS 3.0 `/p3/serviceValidate`, attributes optional/institution-
 * configured):
 *   <cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
 *     <cas:authenticationSuccess>
 *       <cas:user>jdoe123</cas:user>
 *       <cas:attributes>
 *         <cas:netid>jdoe123</cas:netid>
 *         <cas:byuId>123456789</cas:byuId>
 *       </cas:attributes>
 *     </cas:authenticationSuccess>
 *   </cas:serviceResponse>
 *
 * Failure:
 *   <cas:serviceResponse>
 *     <cas:authenticationFailure code="INVALID_TICKET">
 *       Ticket 'ST-...' not recognized
 *     </cas:authenticationFailure>
 *   </cas:serviceResponse>
 */
export type CasServiceResponse =
  | { success: true; user: string; attributes: Record<string, string> }
  | { success: false; code?: string; message?: string };

export function parseCasServiceResponse(xml: string): CasServiceResponse {
  const failureMatch = xml.match(/<cas:authenticationFailure(?:\s+code="([^"]*)")?[^>]*>([\s\S]*?)<\/cas:authenticationFailure>/);
  if (failureMatch) {
    return { success: false, code: failureMatch[1], message: failureMatch[2].trim() };
  }

  const userMatch = xml.match(/<cas:user>([\s\S]*?)<\/cas:user>/);
  if (!userMatch) {
    return { success: false };
  }

  const attributes: Record<string, string> = {};
  const attributesBlock = xml.match(/<cas:attributes>([\s\S]*?)<\/cas:attributes>/);
  if (attributesBlock) {
    const attributeRegex = /<cas:([a-zA-Z0-9_-]+)>([\s\S]*?)<\/cas:\1>/g;
    let match: RegExpExecArray | null;
    while ((match = attributeRegex.exec(attributesBlock[1])) !== null) {
      attributes[match[1]] = match[2].trim();
    }
  }

  return { success: true, user: userMatch[1].trim(), attributes };
}
