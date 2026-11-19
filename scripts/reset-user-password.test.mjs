// The reset script must: refuse an unknown username (and an app admin unless allowed) without
// changing anything, set a random temporary password for the right uid, revoke sessions, flag
// mustChangePassword, write an audit row without the password, and store the password ONLY in
// passwordResets/ (admin-readable) — this repo is public, so never in the log or job summary.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn((x) => x) }));

const updateUser = vi.fn(async () => { order.push('updateUser'); });
const revokeRefreshTokens = vi.fn(async () => undefined);
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ updateUser, revokeRefreshTokens }) }));

const userUpdate = vi.fn(async () => undefined);
const auditAdd = vi.fn(async () => undefined);
const resetSet = vi.fn(async () => undefined);
let order = [];
function mockUsers(rows) {
  vi.doMock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
      collection: (name) => {
        if (name === 'users') {
          return { where: (_f, _op, v) => ({ limit: () => ({ get: async () => {
            const hit = rows.filter((r) => r.username === v);
            return { empty: hit.length === 0, docs: hit.map((r) => ({ id: r.id, data: () => r, ref: { update: userUpdate } })) };
          } }) }) };
        }
        if (name === 'auditLog') return { add: auditAdd };
        if (name === 'passwordResets') return { doc: (id) => ({ set: async (d) => { order.push('store'); return resetSet(id, d); } }) };
        throw new Error('unexpected collection ' + name);
      },
    }),
  }));
}

describe('reset-user-password', () => {
  beforeEach(() => {
    vi.resetModules();
    updateUser.mockClear(); revokeRefreshTokens.mockClear(); userUpdate.mockClear(); auditAdd.mockClear(); resetSet.mockClear(); order = [];
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'opd-drug-stock' });
    process.env.GITHUB_ACTOR = 'octo-admin';
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.ALLOW_ADMIN_RESET;
  });

  it('generates 12-char passwords from the unambiguous alphabet', async () => {
    mockUsers([]);
    const { generateTempPassword } = await import('./reset-user-password.mjs');
    const seen = new Set();
    for (let i = 0; i < 50; i++) { const p = generateTempPassword(); expect(p).toMatch(/^[a-hjkmnp-zA-HJKLMNP-Z2-9]{12}$/); seen.add(p); }
    expect(seen.size).toBe(50);
  });

  it('resets the right user, flags mustChangePassword, audits without the password, and keeps the password out of the log', async () => {
    mockUsers([{ id: 'uid-9', username: 'somsri', name: 'สมศรี' }, { id: 'uid-1', username: 'other', name: 'คนอื่น' }]);
    process.env.RESET_USERNAME = '  SomSri ';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { main } = await import('./reset-user-password.mjs');
    await main();

    expect(updateUser).toHaveBeenCalledTimes(1);
    const [uid, patch] = updateUser.mock.calls[0];
    expect(uid).toBe('uid-9');
    expect(patch.password).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(revokeRefreshTokens).toHaveBeenCalledWith('uid-9');
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: true, passwordResetBy: 'github:octo-admin' }));
    const audit = auditAdd.mock.calls[0][0];
    expect(audit.type).toBe('user_password_reset');
    expect(audit.note).toContain('@somsri');
    expect(audit.note).not.toContain(patch.password);
    // stored for the admin FIRST, then the password is changed — never a changed password nobody can read
    expect(resetSet).toHaveBeenCalledWith('uid-9', expect.objectContaining({ tempPassword: patch.password, username: 'somsri' }));
    expect(order).toEqual(['store', 'updateUser']);
    expect(log.mock.calls.flat().join(' ')).not.toContain(patch.password);
    log.mockRestore();
  });

  it('refuses to reset an app admin unless explicitly allowed', async () => {
    mockUsers([{ id: 'uid-A', username: 'boss', name: 'แอดมิน', role: 'admin' }]);
    process.env.RESET_USERNAME = 'boss';
    const exit = vi.spyOn(process, 'exit').mockImplementation((c) => { throw new Error('exit:' + c); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { main } = await import('./reset-user-password.mjs');
    await expect(main()).rejects.toThrow('exit:1');
    expect(updateUser).not.toHaveBeenCalled();
    expect(resetSet).not.toHaveBeenCalled();
    exit.mockRestore(); err.mockRestore();
  });

  it('refuses an unknown username and changes nothing', async () => {
    mockUsers([{ id: 'uid-1', username: 'other', name: 'คนอื่น' }]);
    process.env.RESET_USERNAME = 'nobody';
    const exit = vi.spyOn(process, 'exit').mockImplementation((c) => { throw new Error('exit:' + c); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { main } = await import('./reset-user-password.mjs');
    await expect(main()).rejects.toThrow('exit:1');
    expect(updateUser).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    exit.mockRestore(); err.mockRestore();
  });
});
