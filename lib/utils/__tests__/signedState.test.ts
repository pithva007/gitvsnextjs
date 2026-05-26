import { createSignedState, verifySignedState } from '../signedState';

describe('signedState', () => {
  const originalSecret = process.env.GITHUB_APP_STATE_SECRET;

  beforeAll(() => {
    process.env.GITHUB_APP_STATE_SECRET = 'test-secret-key-123456';
  });

  afterAll(() => {
    process.env.GITHUB_APP_STATE_SECRET = originalSecret;
  });

  it('creates and verifies signed states correctly', () => {
    const payload = { userId: '123', org: 'test-org' };
    const signed = createSignedState(payload);

    expect(signed).toContain('.');
    
    const result = verifySignedState<typeof payload>(signed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual(payload);
    }
  });

  it('fails verification if state has incorrect format', () => {
    expect(verifySignedState('invalidstate')).toEqual({ ok: false, error: 'missing_state' });
    expect(verifySignedState('a.')).toEqual({ ok: false, error: 'bad_state' });
  });

  it('fails verification if signature is incorrect or signature is modified', () => {
    const payload = { userId: '123' };
    const signed = createSignedState(payload);
    
    // Modify signature part
    const [body, sig] = signed.split('.');
    const badSigned = `${body}.badsignature123`;
    
    expect(verifySignedState(badSigned)).toEqual({ ok: false, error: 'invalid_signature' });
  });

  it('fails verification if GITHUB_APP_STATE_SECRET is not configured', () => {
    process.env.GITHUB_APP_STATE_SECRET = '';
    process.env.NEXTAUTH_SECRET = '';

    expect(() => createSignedState({ a: 1 })).toThrow();
  });
});
