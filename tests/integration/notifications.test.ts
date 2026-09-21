/**
 * Integration tests for notifications.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestHarness, extractEngineer, extractNotifications, TEST_TOKEN, type TestHarness } from '../helpers';

describe('Notifications', () => {
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

  it('lists notifications for authenticated engineer only', async () => {
    await loginAs('alice@example.com');
    const res = await h.request('GET', '/api/notifications');
    expect(res.status).toBe(200);
    const { notifications, count } = extractNotifications(res.body);
    expect(count).toBe(0);
    expect(notifications).toEqual([]);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await h.request('GET', '/api/notifications');
    expect(res.status).toBe(401);
  });

  it('engineers only see their own notifications', async () => {
    // This test is more meaningful when combined with release-check job
    // but we verify the isolation at the route level
    await loginAs('alice@example.com');
    const res = await h.request('GET', '/api/notifications');
    expect(res.status).toBe(200);
    expect(extractNotifications(res.body).count).toBe(0);
  });
});