// The reset script must: refuse an unknown username without changing anything, set a random
// temporary password for the right uid, revoke sessions, flag mustChangePassword, write an audit
// row without the password, and put the password only in the job summary — never the log.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn((x) => x) }));

const updateUser = vi.fn(async () => undefined);
const revokeRefreshTokens = vi.fn(async () => undefined);
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ updateUser, revokeRefreshTokens }) }));

const userUpdate = vi.fn(async () => undefined);
const auditAdd = vi.fn(async () => undefined);
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
        throw new Error('unexpected collection ' + name);
      },
    }),
  }));
}

describe('reset-user-password', () => {
  let summaryFile;
  beforeEach(() => {
    vi.resetModules();
    updateUser.mockClear(); revokeRefreshTokens.mockClear(); userUpdate.mockClear(); auditAdd.mockClear();
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'opd-drug-stock' });
    process.env.GITHUB_ACTOR = 'octo-admin';
    summaryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rst-')), 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summaryFile;
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
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain(patch.password);
    expect(log.mock.calls.flat().join(' ')).not.toContain(patch.password);
    log.mockRestore();
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
