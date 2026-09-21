/**
 * Integration tests for authentication.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestHarness, extractEngineer, TEST_TOKEN, type TestHarness } from '../helpers';

describe('Authentication', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  it('registers a new engineer', async () => {
    const res = await h.request('POST', '/api/auth/register', {
      email: 'alice@example.com',
      password: 'password123',
      displayName: 'Alice',
    });
    expect(res.status).toBe(201);
    const engineer = extractEngineer(res.body);
    expect(engineer.email).toBe('alice@example.com');
    expect(engineer.displayName).toBe('Alice');
  });

  it('rejects duplicate email', async () => {
    await h.registerUser('alice@example.com', 'password123', 'Alice');
    const res = await h.request('POST', '/api/auth/register', {
      email: 'alice@example.com',
      password: 'different',
      displayName: 'Alice 2',
    });
    expect(res.status).toBe(409);
  });

  it('logs in an existing engineer', async () => {
    await h.registerUser('alice@example.com', 'password123', 'Alice');
    const res = await h.request('POST', '/api/auth/login', {
      email: 'alice@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    const engineer = extractEngineer(res.body);
    expect(engineer.email).toBe('alice@example.com');
  });

  it('rejects wrong password', async () => {
    await h.registerUser('alice@example.com', 'password123', 'Alice');
    const res = await h.request('POST', '/api/auth/login', {
      email: 'alice@example.com',
      password: 'wrong',
    });
    expect(res.status).toBe(400);
  });

  it('returns current engineer on /me when authenticated', async () => {
    await h.registerUser('alice@example.com', 'password123', 'Alice');
    await h.loginUser('alice@example.com', 'password123');
    const res = await h.request('GET', '/api/auth/me');
    expect(res.status).toBe(200);
    const engineer = extractEngineer(res.body);
    expect(engineer.email).toBe('alice@example.com');
  });

  it('returns 401 on /me when not authenticated', async () => {
    const res = await h.request('GET', '/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('logs out and clears session', async () => {
    await h.registerUser('alice@example.com', 'password123', 'Alice');
    await h.loginUser('alice@example.com', 'password123');
    await h.logoutUser();
    const res = await h.request('GET', '/api/auth/me');
    expect(res.status).toBe(401);
  });
});