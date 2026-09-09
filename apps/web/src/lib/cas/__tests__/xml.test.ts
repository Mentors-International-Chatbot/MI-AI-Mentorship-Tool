import { describe, it, expect } from 'vitest';
import { parseCasServiceResponse } from '../xml';

describe('parseCasServiceResponse — success', () => {
  it('parses a CAS 2.0-shaped response with just cas:user, no attributes block', () => {
    const xml = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
      <cas:authenticationSuccess>
        <cas:user>jdoe123</cas:user>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`;

    const result = parseCasServiceResponse(xml);

    expect(result).toEqual({ success: true, user: 'jdoe123', attributes: {} });
  });

  it('parses a CAS 3.0-shaped response with released attributes', () => {
    const xml = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
      <cas:authenticationSuccess>
        <cas:user>jdoe123</cas:user>
        <cas:attributes>
          <cas:netid>jdoe123</cas:netid>
          <cas:byuId>123456789</cas:byuId>
          <cas:displayName>Jane Doe</cas:displayName>
        </cas:attributes>
      </cas:authenticationSuccess>
    </cas:serviceResponse>`;

    const result = parseCasServiceResponse(xml);

    expect(result).toEqual({
      success: true,
      user: 'jdoe123',
      attributes: { netid: 'jdoe123', byuId: '123456789', displayName: 'Jane Doe' },
    });
  });

  it('trims whitespace around cas:user and attribute values', () => {
    const xml = `<cas:authenticationSuccess>
      <cas:user>
        jdoe123
      </cas:user>
      <cas:attributes><cas:byuId>
        123456789
      </cas:byuId></cas:attributes>
    </cas:authenticationSuccess>`;

    const result = parseCasServiceResponse(xml);

    expect(result).toEqual({ success: true, user: 'jdoe123', attributes: { byuId: '123456789' } });
  });
});

describe('parseCasServiceResponse — failure', () => {
  it('parses an authenticationFailure with a code and message', () => {
    const xml = `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
      <cas:authenticationFailure code="INVALID_TICKET">
        Ticket 'ST-abc123' not recognized
      </cas:authenticationFailure>
    </cas:serviceResponse>`;

    const result = parseCasServiceResponse(xml);

    expect(result).toEqual({
      success: false,
      code: 'INVALID_TICKET',
      message: "Ticket 'ST-abc123' not recognized",
    });
  });

  it('treats a response with neither success nor failure markers as a failure', () => {
    const result = parseCasServiceResponse('<cas:serviceResponse></cas:serviceResponse>');
    expect(result).toEqual({ success: false });
  });

  it('treats garbage input as a failure rather than throwing', () => {
    const result = parseCasServiceResponse('not xml at all');
    expect(result.success).toBe(false);
  });
});
