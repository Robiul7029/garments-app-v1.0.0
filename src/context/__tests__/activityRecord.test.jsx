import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The notification recorder must resolve the module's ROUTE.
 *
 * `record()` builds the notification from `describe(key)`, which returns an object
 * carrying `path`. The call that wrote the notification referenced a bare `path`
 * variable that did not exist in that scope, so every recorded action — create,
 * update, delete — threw "ReferenceError: path is not defined" and the Firestore
 * write never happened.
 *
 * This drives the real provider and asserts the route actually reaches
 * `createNotification`, which is the thing the bug broke.
 */
const created = [];

vi.mock('../../services/notificationService', () => ({
  NOTIFICATIONS: 'notifications',
  createNotification: vi.fn(async (payload) => {
    created.push(payload);
    return { ok: true };
  }),
  markAllNotificationsRead: vi.fn(async () => true),
  markNotificationRead: vi.fn(async () => true),
  deleteNotification: vi.fn(async () => true),
  todayKey: () => '2026-10-12',
}));

// The provider subscribes to Firestore on mount; the subscription is irrelevant to
// this test, so it is stubbed to a no-op rather than opening a real listener.
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  limit: () => ({}),
  onSnapshot: () => () => {},
  orderBy: () => ({}),
  query: () => ({}),
  where: () => ({}),
}));

vi.mock('../../firebase', () => ({ db: {} }));

async function mountProvider() {
  const { ActivityProvider, useActivity } = await import('../ActivityContext');
  const { AuthContext } = await import('../AuthContext');

  let captured = null;
  function Probe() {
    captured = useActivity();
    return null;
  }

  renderToStaticMarkup(
    <AuthContext.Provider value={{ user: { id: 'u1', username: 'QA' } }}>
      <ActivityProvider>
        <Probe />
      </ActivityProvider>
    </AuthContext.Provider>,
  );
  return captured;
}

describe('recording an activity notification', () => {
  beforeEach(() => {
    created.length = 0;
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  });

  it('passes the module route without throwing', async () => {
    const activity = await mountProvider();
    // A known menu key, so `describe()` resolves a real label and route.
    await expect(
      activity.record('create', { key: 'daily-production', entry: { id: 1 }, actor: 'QA' }),
    ).resolves.toBeTruthy();
  });

  it('sends the resolved route as targetRoute', async () => {
    const activity = await mountProvider();
    await activity.record('create', { key: 'daily-production', entry: { id: 1 }, actor: 'QA' });

    expect(created).toHaveLength(1);
    // The route is the one `modulePath` builds for that menu key — a real path,
    // never `undefined` (which is what the broken reference produced).
    expect(created[0].targetRoute).toBe('/production/daily-production');
    expect(created[0].targetRoute).not.toBeUndefined();
  });

  it('resolves a route for an update and a delete too', async () => {
    const activity = await mountProvider();
    // `quality-control` is a visible Sewing Department item; the module route is
    // the one `modulePath` builds for that menu key — a real path, never
    // `undefined` (which is what the broken reference produced).
    await activity.record('update', { key: 'quality-control', entry: { id: 2 }, actor: 'QA' });
    await activity.record('delete', { key: 'quality-control', entry: { id: 2 }, actor: 'QA' });

    expect(created).toHaveLength(2);
    created.forEach((payload) => {
      expect(payload.targetRoute).toBe('/production/quality-control');
      expect(payload.targetRoute).not.toBeUndefined();
    });
  });

  it('falls back to the workspace route for an unknown key', async () => {
    const activity = await mountProvider();
    await activity.record('create', { key: 'not-a-module', entry: { id: 3 }, actor: 'QA' });

    // `describe()` defaults to '/', so an unrecognised key still routes somewhere
    // real rather than leaving the bell item unclickable.
    expect(created[0].targetRoute).toBe('/');
  });
});