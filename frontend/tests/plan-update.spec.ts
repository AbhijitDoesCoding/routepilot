import { test, expect, type Route } from '@playwright/test';

// Goal A integration tests. The pure diff helper is covered in
// tests/planChanges.test.ts; these tests verify the compact UI is driven only
// by final, successful canonical plan responses.

const basePlan = {
  id: 'plan-base',
  origin: { name: 'Home', lat: 18.5, lon: 73.8 },
  destination: { name: 'Pune Airport', lat: 18.57, lon: 73.9 },
  departureTime: '2026-10-07T05:58:00Z',
  actualEta: '2026-10-07T06:50:00Z',
  arrivalDeadline: '2026-10-07T07:00:00Z',
  durationMinutes: 52,
  drivingDurationMinutes: 52,
  stopDurationMinutes: 0,
  distanceKm: 21.4,
  bufferMinutes: 10,
  routeGeometry: {
    type: 'LineString',
    coordinates: [[73.8, 18.5], [73.9, 18.57]],
  },
  constraintEvaluations: [
    { type: 'avoid_tolls', severity: 'hard', status: 'satisfied' },
  ],
};

const cafePlan = {
  ...basePlan,
  id: 'plan-stop',
  stops: [{ name: 'Vohuman Cafe', lat: 18.535, lon: 73.875, durationMinutes: 15 }],
  departureTime: '2026-10-07T05:43:00Z',
  actualEta: '2026-10-07T06:55:00Z',
  durationMinutes: 67,
  stopDurationMinutes: 15,
  distanceKm: 22.1,
  bufferMinutes: 5,
  routeGeometry: {
    type: 'LineString',
    coordinates: [[73.8, 18.5], [73.875, 18.535], [73.9, 18.57]],
  },
};

const cafeNoHighwaysPlan = {
  ...cafePlan,
  id: 'plan-stop-nohwy',
  departureTime: '2026-10-07T05:25:00Z',
  durationMinutes: 85,
  drivingDurationMinutes: 70,
  distanceKm: 23.5,
  constraintEvaluations: [
    { type: 'avoid_tolls', severity: 'hard', status: 'satisfied' },
    { type: 'avoid_highways', severity: 'hard', status: 'satisfied' },
  ],
};

const fulfill = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const send = async (page: import('@playwright/test').Page, text: string) => {
  await page.getByLabel('Message input').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
};

test.describe('Phase 2 Goal A: canonical plan update summary', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('routepilot.voice-mode', 'browser');
      } catch {
        // Storage is optional.
      }
    });
    await page.route('/api/plan*', (route) =>
      fulfill(route, 200, { travelPlan: null })
    );
  });

  test('first plan is not presented as an update', async ({ page }) => {
    await page.route('/api/chat', (route) =>
      fulfill(route, 200, { message: 'Direct route ready.', travelPlan: basePlan })
    );

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('Plan updated')).toHaveCount(0);
    await expect(page.getByText('Plan unchanged')).toHaveCount(0);
  });

  test('stop, departure, duration, and unchanged deadline are summarized', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      if (message === 'Add a coffee stop.') {
        return fulfill(route, 200, {
          message: 'Coffee stop added.',
          travelPlan: cafePlan,
        });
      }
      return fulfill(route, 200, { message: 'Direct route ready.', travelPlan: basePlan });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toBeVisible();

    await send(page, 'Add a coffee stop.');
    await expect(page.getByText('Coffee stop added.')).toBeVisible();

    const summary = page.getByRole('status').filter({ hasText: 'Plan updated' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Vohuman Cafe added to the route.');
    await expect(summary).toContainText(/Departure changed from .+ to .+\./);
    await expect(summary).toContainText(/Estimated arrival changed from .+ to .+\./);

    await summary.getByRole('button', { name: 'Show 2 more plan changes' }).click();
    await expect(summary).toContainText(/Total duration changed from 52 to 67 minutes\./);
    await expect(summary).toContainText(/Arrival deadline unchanged — .+\./);
  });

  test('retained stop dwell and added constraint are summarized together', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      if (message === 'Avoid highways.') {
        return fulfill(route, 200, {
          message: 'Highways avoided.',
          travelPlan: cafeNoHighwaysPlan,
        });
      }
      return fulfill(route, 200, { message: 'Coffee stop added.', travelPlan: cafePlan });
    });

    await page.goto('/');
    await send(page, 'Add a coffee stop.');
    await expect(page.getByText('Coffee stop added.')).toBeVisible();

    await send(page, 'Avoid highways.');
    await expect(page.getByText('Highways avoided.')).toBeVisible();

    const summary = page.getByRole('status').filter({ hasText: 'Plan updated' });
    await expect(summary).toContainText('Highway avoidance added.');
    await expect(summary).toContainText('Vohuman Cafe retained — 15-minute stop.');
  });

  test('successful no-op is distinct from a failure', async ({ page }) => {
    await page.route('/api/chat', (route) =>
      fulfill(route, 200, { message: 'Route checked.', travelPlan: basePlan })
    );

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toHaveCount(0);
    await expect(page.getByText('Route checked.')).toBeVisible();

    await send(page, 'Is this still the best route?');
    await expect(page.getByText('Route checked.')).toHaveCount(2);

    const summary = page.getByRole('status').filter({ hasText: 'Plan unchanged' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('No route or timing changes.');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a failed update clears the previous success summary and shows no new one', async ({ page }) => {
    let call = 0;
    await page.route('/api/chat', (route) => {
      call += 1;
      if (call === 1) {
        return fulfill(route, 200, { message: 'Direct route ready.', travelPlan: basePlan });
      }
      if (call === 2) {
        return fulfill(route, 200, { message: 'Coffee stop added.', travelPlan: cafePlan });
      }
      return fulfill(route, 500, { error: 'Route planning is temporarily unavailable.' });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toBeVisible();
    await send(page, 'Add a coffee stop.');
    await expect(page.getByRole('status').filter({ hasText: 'Plan updated' })).toBeVisible();

    await send(page, 'Try again.');
    await expect(page.getByRole('alert')).toContainText(
      'Route planning is temporarily unavailable.'
    );
    await expect(page.getByRole('status').filter({ hasText: 'Plan updated' })).toHaveCount(0);
  });

  test('polling and the final response produce one summary and one user bubble', async ({ page }) => {
    let chatCalls = 0;
    await page.route('/api/plan*', (route) =>
      fulfill(route, 200, { travelPlan: chatCalls >= 2 ? cafePlan : null })
    );
    await page.route('/api/chat', async (route) => {
      chatCalls += 1;
      if (chatCalls === 1) {
        return fulfill(route, 200, { message: 'Direct route ready.', travelPlan: basePlan });
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return fulfill(route, 200, { message: 'Coffee stop added.', travelPlan: cafePlan });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toBeVisible();

    await send(page, 'Add a coffee stop.');
    await expect(page.getByText('Coffee stop added.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Plan updated' })).toHaveCount(1);
    await expect(page.getByText('Add a coffee stop.', { exact: true })).toHaveCount(1);
    await expect(page.locator('#trip-summary')).toHaveCount(1);
    await expect(page.locator('.maplibregl-marker')).toHaveCount(3);
  });

  test('the summary is dismissible and replaced by the next update', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      if (message === 'Add a coffee stop.') {
        return fulfill(route, 200, { message: 'Coffee stop added.', travelPlan: cafePlan });
      }
      if (message === 'Remove the current stop.') {
        return fulfill(route, 200, { message: 'Stop removed.', travelPlan: basePlan });
      }
      return fulfill(route, 200, { message: 'Direct route ready.', travelPlan: basePlan });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Direct route ready.')).toBeVisible();

    await send(page, 'Add a coffee stop.');
    await expect(page.getByText('Coffee stop added.')).toBeVisible();
    const first = page.getByRole('status').filter({ hasText: 'Plan updated' });
    await expect(first).toContainText('Vohuman Cafe added to the route.');
    await first.getByRole('button', { name: 'Dismiss plan update' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Plan updated' })).toHaveCount(0);

    await send(page, 'Remove the current stop.');
    await expect(page.getByText('Stop removed.')).toBeVisible();
    const second = page.getByRole('status').filter({ hasText: 'Plan updated' });
    await expect(second).toContainText('Vohuman Cafe removed from the route.');
  });
});
