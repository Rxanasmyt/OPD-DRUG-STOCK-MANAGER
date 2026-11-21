// Admin-only warning when the daily backup stamp (meta/backupStatus) is older than 36 h.
import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import BackupReminder from './BackupReminder';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, hasListener, seedDoc } from '../test-utils/firebaseTestDouble';

afterEach(() => sessionStorage.clear());
const H = 3600000;
async function boot(role: 'admin' | 'pharm', stamp: number | null) {
  seedDoc('meta/backupStatus', stamp == null ? null : { lastBackupAt: stamp });
  renderWithApp(<BackupReminder />);
  await signInAs('u1', { role, name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  await new Promise((r) => setTimeout(r, 50));
}

describe('BackupReminder', () => {
  it('warns an admin when the last verified backup is 3 days old', async () => {
    await boot('admin', Date.now() - 72 * H);
    expect(await screen.findByTestId('backup-reminder')).toHaveTextContent('3 วัน');
  });
  it('stays quiet when the backup is fresh', async () => {
    await boot('admin', Date.now() - 5 * H);
    expect(screen.queryByTestId('backup-reminder')).not.toBeInTheDocument();
  });
  it('stays quiet for non-admins and when no stamp exists yet', async () => {
    await boot('pharm', Date.now() - 72 * H);
    expect(screen.queryByTestId('backup-reminder')).not.toBeInTheDocument();
  });
  it('says nothing when the stamp was never written', async () => {
    await boot('admin', null);
    expect(screen.queryByTestId('backup-reminder')).not.toBeInTheDocument();
  });
});
