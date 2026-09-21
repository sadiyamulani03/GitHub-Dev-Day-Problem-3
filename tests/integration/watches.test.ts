/**
 * Integration tests for watches.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestHarness, extractEngineer, extractWatch, extractWatches, TEST_TOKEN, type TestHarness } from '../helpers';

describe('Watches', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  async function loginAs(email: string): Promise<void> {
    await h.registerUser(email, 'password123', email.split('@')[0]);
    await h.loginUser(email, 'password123');
  }

  it('creates a watch for authenticated engineer', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    expect(res.status).toBe(201);
    const watch = extractWatch(res.body);
    expect(watch.owner).toBe('facebook');
    expect(watch.repo).toBe('react');
    expect(watch.repository).toBe('facebook/react');
  });

  it('lists watches for authenticated engineer only', async () => {
    await loginAs('alice@example.com');
    await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    await h.request('POST', '/api/watches', { repository: 'vuejs/vue' });

    const res = await h.request('GET', '/api/watches');
    expect(res.status).toBe(200);
    const { watches, count } = extractWatches(res.body);
    expect(count).toBe(2);
    expect(watches.map((w) => w.repository).sort()).toEqual(['facebook/react', 'vuejs/vue']);
  });

  it('prevents duplicate watches for same engineer (database-level)', async () => {
    await loginAs('alice@example.com');
    await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    const res = await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'duplicate_watch',
        message: 'You are already watching this repository.',
      }),
    );
  });

  it('allows different engineers to watch same repository', async () => {
    await loginAs('alice@example.com');
    await h.request('POST', '/api/watches', { repository: 'facebook/react' });

    await h.logoutUser();
    await loginAs('bob@example.com');
    const res = await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    expect(res.status).toBe(201);
  });

  it('deletes own watch', async () => {
    await loginAs('alice@example.com');
    const createRes = await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    const watch = extractWatch(createRes.body);

    const delRes = await h.request('DELETE', `/api/watches/${watch.id}`);
    expect(delRes.status).toBe(204);

    const listRes = await h.request('GET', '/api/watches');
    expect(extractWatches(listRes.body).count).toBe(0);
  });

  it('returns 404 when deleting non-existent watch', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('DELETE', '/api/watches/999999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'watch_not_found',
      }),
    );
  });

  it('returns 403 when deleting another engineer\'s watch', async () => {
    await loginAs('alice@example.com');
    const createRes = await h.request('POST', '/api/watches', { repository: 'facebook/react' });
    const watch = extractWatch(createRes.body);

    await h.logoutUser();
    await loginAs('bob@example.com');

    const res = await h.request('DELETE', `/api/watches/${watch.id}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'watch_forbidden',
        message: 'You do not have permission to delete this watch.',
      }),
    );
  });

  it('returns 401 when not authenticated', async () => {
    const res = await h.request('GET', '/api/watches');
    expect(res.status).toBe(401);
  });

  it('normalizes repository to lowercase', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('POST', '/api/watches', { repository: 'Facebook/React' });
    expect(res.status).toBe(201);
    const watch = extractWatch(res.body);
    expect(watch.owner).toBe('facebook');
    expect(watch.repo).toBe('react');
  });

  it('rejects invalid repository format', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('POST', '/api/watches', { repository: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid watch id on delete', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('DELETE', '/api/watches/abc');
    expect(res.status).toBe(400);
  });
});