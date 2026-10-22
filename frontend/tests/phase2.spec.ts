import { test, expect, type Route } from '@playwright/test';

// Deterministic fixtures only: every /api/chat and /api/plan call is mocked.

const basePlan = {
  id: "plan-base",
  origin: { name: "Home", lat: 18.5, lon: 73.8 },
  destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
  departureTime: "2026-10-07T05:58:00Z",
  actualEta: "2026-10-07T06:50:00Z",
  arrivalDeadline: "2026-10-07T07:00:00Z",
  durationMinutes: 52,
  drivingDurationMinutes: 52,
  stopDurationMinutes: 0,
  distanceKm: 21.4,
  bufferMinutes: 10,
  routeGeometry: {
    type: "LineString",
    coordinates: [[73.8, 18.5], [73.9, 18.57]],
  },
  constraintEvaluations: [
    { type: "avoid_tolls", severity: "hard", status: "satisfied" },
  ],
};

const stopPlan = {
  ...basePlan,
  id: "plan-stop",
  stops: [{ name: "Café Corner", lat: 18.535, lon: 73.875, durationMinutes: 15 }],
  departureTime: "2026-10-07T05:43:00Z",
  actualEta: "2026-10-07T06:55:00Z",
  durationMinutes: 67,
  stopDurationMinutes: 15,
  distanceKm: 22.1,
  bufferMinutes: 5,
  routeGeometry: {
    type: "LineString",
    coordinates: [[73.8, 18.5], [73.875, 18.535], [73.9, 18.57]],
  },
};

const fulfillJson = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const alert = (page: import('@playwright/test').Page) => page.getByRole('alert');
const retryButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Retry' });
const summary = (page: import('@playwright/test').Page) => page.locator('#trip-summary');

async function send(page: import('@playwright/test').Page, text: string) {
  await page.getByLabel('Message input').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

// Local Kokoro TTS would download model weights on the first assistant reply.
// Keep these tests on the browser voice path so no external model is fetched.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('routepilot.voice-mode', 'browser');
    } catch {
      // Storage may be unavailable; the tests do not rely on voice behavior.
    }
  });
});

test.describe('Phase 2 Goal B: resilient chat state', () => {
  test('provider failure keeps the previous plan stale and re-enables the composer', async ({ page }) => {
    let call = 0;
    await page.route('/api/chat', async (route) => {
      call += 1;
      if (call === 1) {
        return fulfillJson(route, 200, { message: 'Route ready.', travelPlan: basePlan });
      }
      return fulfillJson(route, 503, { error: 'Routing provider is unavailable.' });
    });

    await page.goto('/');
    await send(page, 'Get me to Pune Airport.');
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(summary(page)).toContainText('21.4 km');

    await send(page, 'Leave 10 minutes later.');

    await expect(alert(page)).toContainText('Routing provider is unavailable.');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();
    await expect(summary(page)).toContainText(
      'Latest update failed: Routing provider is unavailable.'
    );

    // The previous route is preserved, not blanked.
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(summary(page)).toContainText('21.4 km');

    // Composer is usable once the failed request settles.
    const input = page.getByLabel('Message input');
    await input.fill('Try another route.');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  test('retry replays the failed text once and transitions stale to fresh', async ({ page }) => {
    const bodies: string[] = [];
    let call = 0;
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      bodies.push(message);
      call += 1;
      if (call === 2) {
        return fulfillJson(route, 500, { error: 'Planning failed upstream.' });
      }
      if (call === 3) {
        return fulfillJson(route, 200, { message: 'Recovered route ready.', travelPlan: stopPlan });
      }
      return fulfillJson(route, 200, { message: 'Route ready.', travelPlan: basePlan });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();

    await send(page, 'Also avoid highways.');
    await expect(alert(page)).toContainText('Planning failed upstream.');
    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();

    await retryButton(page).click();
    await expect(page.getByText('Recovered route ready.')).toBeVisible();

    // Stale -> fresh: canonical plan wins again and the error clears.
    await expect(page.getByText('Last Successful Plan (Stale)')).toHaveCount(0);
    await expect(page.getByText('Recommended Plan')).toBeVisible();
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();
    await expect(alert(page)).toHaveCount(0);

    // One user bubble for the failed text, and the retry carried it exactly once.
    await expect(page.getByText('Also avoid highways.', { exact: true })).toHaveCount(1);
    expect(bodies).toEqual(['Plan my trip.', 'Also avoid highways.', 'Also avoid highways.']);
  });

  test('rapid double click and double Enter produce one request each', async ({ page }) => {
    const bodies: string[] = [];
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      bodies.push(message);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return fulfillJson(route, 200, { message: `Reply: ${message}`, travelPlan: basePlan });
    });
    await page.route('/api/plan*', (route) =>
      fulfillJson(route, 200, { travelPlan: basePlan })
    );

    await page.goto('/');
    await page.getByLabel('Message input').fill('Plan my trip.');

    // Two clicks in the same task, before React can disable the button.
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Send message"]');
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByText('Reply: Plan my trip.')).toBeVisible({ timeout: 10000 });

    // Two Enter keydowns in the same task.
    await page.getByLabel('Message input').fill('Leave later.');
    await page.evaluate(() => {
      const input = document.querySelector('textarea[aria-label="Message input"]');
      for (let i = 0; i < 2; i += 1) {
        input!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      }
    });
    await expect(page.getByText('Reply: Leave later.')).toBeVisible({ timeout: 10000 });

    expect(bodies).toEqual(['Plan my trip.', 'Leave later.']);
    await expect(page.getByText('Plan my trip.', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Leave later.', { exact: true })).toHaveCount(1);
  });

  test('a failed retry stays stale and remains retryable', async ({ page }) => {
    const bodies: string[] = [];
    let call = 0;
    await page.route('/api/chat', async (route) => {
      const { message } = route.request().postDataJSON();
      bodies.push(message);
      call += 1;
      if (call === 1) {
        return fulfillJson(route, 200, { message: 'Route ready.', travelPlan: basePlan });
      }
      if (call === 2) {
        return fulfillJson(route, 503, { error: 'Provider unavailable.' });
      }
      if (call === 3) {
        return fulfillJson(route, 500, { error: 'Provider still unavailable.' });
      }
      return fulfillJson(route, 200, { message: 'Finally recovered.', travelPlan: stopPlan });
    });

    await page.goto('/');
    await send(page, 'Base trip.');
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();

    await send(page, 'Avoid highways.');
    await expect(alert(page)).toContainText('Provider unavailable.');

    await retryButton(page).click();
    await expect(alert(page)).toContainText('Provider still unavailable.');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();
    await expect(summary(page)).toContainText(
      'Latest update failed: Provider still unavailable.'
    );

    // Still retryable after the failed retry; retry never adds a user bubble.
    await retryButton(page).click();
    await expect(page.getByText('Finally recovered.')).toBeVisible();
    await expect(page.getByText('Last Successful Plan (Stale)')).toHaveCount(0);
    await expect(page.getByText('Avoid highways.', { exact: true })).toHaveCount(1);
    expect(bodies).toEqual(['Base trip.', 'Avoid highways.', 'Avoid highways.', 'Avoid highways.']);
  });

  test('a stale final payload is treated as a failed update, not a fresh success', async ({ page }) => {
    await page.route('/api/chat', (route) =>
      fulfillJson(route, 200, {
        message: 'The recalculation failed, so the previous route is shown as stale.',
        travelPlan: {
          ...basePlan,
          stale: true,
          staleReason: 'Routing provider unavailable',
        },
      })
    );

    await page.goto('/');
    await send(page, 'Try that again.');

    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();
    await expect(summary(page)).toContainText('Routing provider unavailable');
    await expect(summary(page)).toContainText('The latest recalculation failed');
    await expect(retryButton(page)).toBeVisible();
    await expect(alert(page)).toContainText('The latest route update failed');
    await expect(page.getByText('Recommended Plan')).toHaveCount(0);
    await expect(page.getByText('Try that again.', { exact: true })).toHaveCount(1);
  });

  test('polling and final response with the same plan do not duplicate or flap stale', async ({ page }) => {
    let planRequests = 0;
    await page.addInitScript(() => {
      (window as unknown as { __staleSeen: number }).__staleSeen = 0;
      new MutationObserver(() => {
        if (document.documentElement.textContent?.includes('Stale')) {
          (window as unknown as { __staleSeen: number }).__staleSeen += 1;
        }
      }).observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await page.route('/api/plan*', (route) => {
      planRequests += 1;
      return fulfillJson(route, 200, { travelPlan: basePlan });
    });
    await page.route('/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2400));
      return fulfillJson(route, 200, { message: 'Route ready.', travelPlan: basePlan });
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');

    // The poll paints the map before the agent turn completes.
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('Route ready.')).toBeVisible({ timeout: 15000 });

    // Same payload: one summary card, no stale state.
    await expect(page.locator('#trip-summary')).toHaveCount(1);
    await expect(summary(page)).toContainText('21.4 km');
    await expect(page.getByText('Last Successful Plan (Stale)')).toHaveCount(0);
    expect(planRequests).toBeGreaterThanOrEqual(1);
    expect(
      await page.evaluate(() => (window as unknown as { __staleSeen: number }).__staleSeen)
    ).toBe(0);
  });

  test('an older polling response cannot overwrite the newer final plan', async ({ page }) => {
    await page.route('/api/plan*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return fulfillJson(route, 200, { travelPlan: basePlan });
    });
    await page.route('/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return fulfillJson(route, 200, { message: 'Updated route ready.', travelPlan: stopPlan });
    });

    await page.goto('/');
    const pollResponse = page.waitForResponse((response) => response.url().includes('/api/plan'));
    await send(page, 'Add a coffee stop.');

    await expect(page.getByText('Updated route ready.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();

    // The poll was already in flight when the final response landed.
    await pollResponse;
    await page.waitForTimeout(300);

    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();
    await expect(summary(page)).toContainText('22.1 km');
    await expect(page.getByText('Home → Pune Airport', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Last Successful Plan (Stale)')).toHaveCount(0);
  });

  test('network failures are classified and remain retryable', async ({ page }) => {
    let call = 0;
    await page.route('/api/chat', async (route) => {
      call += 1;
      if (call === 1) {
        return fulfillJson(route, 200, { message: 'Route ready.', travelPlan: basePlan });
      }
      return route.abort('failed');
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();

    await send(page, 'Try again.');
    await expect(alert(page)).toContainText('Could not reach RoutePilot.');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();

    const input = page.getByLabel('Message input');
    await input.fill('Still here?');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  test('timeout failures are classified and leave no assistant message', async ({ page }) => {
    await page.addInitScript(() => {
      const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
      Object.defineProperty(AbortSignal, 'timeout', {
        configurable: true,
        value: (ms: number) => originalTimeout(Math.min(ms, 25)),
      });
    });
    await page.route('/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route
        .fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Too late.', travelPlan: basePlan }),
        })
        .catch(() => {});
    });

    await page.goto('/');
    await send(page, 'Plan my trip.');

    await expect(alert(page)).toContainText('Route planning timed out. Please try again.');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.getByText('Too late.')).toHaveCount(0);

    const input = page.getByLabel('Message input');
    await input.fill('Retry manually.');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });
});
