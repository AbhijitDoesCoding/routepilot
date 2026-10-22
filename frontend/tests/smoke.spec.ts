import { test, expect, type Route } from '@playwright/test';

const basePlan = {
  id: "plan-1",
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
    coordinates: [[73.8, 18.5], [73.9, 18.57]]
  },
  constraintEvaluations: [
    { type: "avoid_tolls", severity: "hard", status: "satisfied" }
  ]
};

const cafePlan = {
  id: "plan-stop",
  origin: { name: "Home", lat: 18.5, lon: 73.8 },
  destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
  stops: [{ name: "Café Corner", lat: 18.535, lon: 73.875, durationMinutes: 15 }],
  departureTime: "2026-10-07T05:43:00Z",
  actualEta: "2026-10-07T06:55:00Z",
  arrivalDeadline: "2026-10-07T07:00:00Z",
  durationMinutes: 67,
  drivingDurationMinutes: 52,
  stopDurationMinutes: 15,
  distanceKm: 22.1,
  bufferMinutes: 5,
  routeGeometry: {
    type: "LineString",
    coordinates: [[73.8, 18.5], [73.875, 18.535], [73.9, 18.57]]
  },
  constraintEvaluations: [
    { type: "avoid_tolls", severity: "hard", status: "satisfied" }
  ]
};

const noHighwaysPlan = {
  ...cafePlan,
  id: "plan-stop-nohwy",
  departureTime: "2026-10-07T05:25:00Z",
  durationMinutes: 85,
  drivingDurationMinutes: 70,
  distanceKm: 23.5,
  constraintEvaluations: [
    { type: "avoid_tolls", severity: "hard", status: "satisfied" },
    { type: "avoid_highways", severity: "hard", status: "satisfied" }
  ]
};

const fulfillJson = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });


test.describe('RoutePilot Alexa+ Simulator E2E Tests', () => {
  // These scenarios exercise route/chat behavior, not on-device model loading.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('routepilot.voice-mode', 'browser');
      } catch {
        // Storage is optional.
      }
    });
  });

  test('Scenario A: Initial simulator state', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toHaveText('RoutePilot');
    await expect(page.getByText('Alexa+ Travel Assistant')).toBeVisible();
    await expect(page.getByText('Ready to plan your route')).toBeVisible();

    // Check example prompts are visible
    await expect(page.getByRole('button', { name: /Get me to Pune Airport/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Find a coffee shop/ })).toBeVisible();

    const input = page.getByLabel('Message input');
    const sendButton = page.getByRole('button', { name: 'Send message' });

    await expect(input).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });

  test('Scenario B: Basic route request and MapLibre rendering', async ({ page }) => {
    await page.goto('/');

    await page.route('/api/chat', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: "I recommend leaving at 5:58 AM. The route takes 52 minutes and avoids tolls.",
          travelPlan: basePlan
        })
      });
    });

    const input = page.getByLabel('Message input');
    const sendButton = page.getByRole('button', { name: 'Send message' });

    await input.fill('I need to reach Pune Airport by 7 AM and avoid tolls.');
    await sendButton.click();

    await expect(page.getByText('I recommend leaving at 5:58 AM.')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('52 min', { exact: true })).toBeVisible();
    await expect(page.getByText('21.4 km')).toBeVisible();
    await expect(page.getByText('10 min buffer')).toBeVisible();
    await expect(page.getByText('✓ avoid tolls', { exact: true })).toBeVisible();
    await expect(page.locator('.maplibregl-marker')).toHaveCount(2);
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });

  test('Scenario C & D & I: Multi-turn stop workflow, constraint update, map persistence', async ({ page }) => {
    await page.goto('/');

    await page.route('/api/chat', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') {
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      const payload = req.postDataJSON();
      if (payload.message.includes('7 AM and avoid tolls')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: "I recommend leaving at 5:58 AM. The route takes 52 minutes and avoids tolls.", travelPlan: basePlan })
        });
      } else if (payload.message.includes('coffee shop')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: "I found Café Corner on your route. With a 15-minute coffee stop, you should leave at 5:43 AM.",
            travelPlan: {
              id: "plan-stop",
              origin: { name: "Home", lat: 18.5, lon: 73.8 },
              destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
              stops: [{ name: "Café Corner", lat: 18.535, lon: 73.875, durationMinutes: 15 }],
              departureTime: "2026-10-07T05:43:00Z",
              actualEta: "2026-10-07T06:55:00Z",
              arrivalDeadline: "2026-10-07T07:00:00Z",
              durationMinutes: 67,
              drivingDurationMinutes: 52,
              stopDurationMinutes: 15,
              distanceKm: 22.1,
              bufferMinutes: 5,
              routeGeometry: {
                type: "LineString",
                coordinates: [[73.8, 18.5], [73.875, 18.535], [73.9, 18.57]]
              },
              constraintEvaluations: [
                { type: "avoid_tolls", severity: "hard", status: "satisfied" }
              ]
            }
          })
        });
      } else if (payload.message.includes('highways too')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: "I updated the route to avoid highways as well.",
            travelPlan: {
              id: "plan-stop-nohwy",
              origin: { name: "Home", lat: 18.5, lon: 73.8 },
              destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
              stops: [{ name: "Café Corner", lat: 18.535, lon: 73.875, durationMinutes: 15 }],
              departureTime: "2026-10-07T05:25:00Z",
              actualEta: "2026-10-07T06:55:00Z",
              arrivalDeadline: "2026-10-07T07:00:00Z",
              durationMinutes: 85,
              drivingDurationMinutes: 70,
              stopDurationMinutes: 15,
              distanceKm: 23.5,
              bufferMinutes: 5,
              routeGeometry: {
                type: "LineString",
                coordinates: [[73.8, 18.5], [73.875, 18.535], [73.9, 18.57]]
              },
              constraintEvaluations: [
                { type: "avoid_tolls", severity: "hard", status: "satisfied" },
                { type: "avoid_highways", severity: "hard", status: "satisfied" }
              ]
            }
          })
        });
      } else {
        await route.continue();
      }
    });

    const input = page.getByLabel('Message input');
    const sendButton = page.getByRole('button', { name: 'Send message' });

    // Turn 1
    await input.fill('I need to reach Pune Airport by 7 AM and avoid tolls.');
    await sendButton.click();
    await expect(page.getByText('I recommend leaving at 5:58 AM.')).toBeVisible();

    // Turn 2: Add coffee stop
    await input.fill('Also find a coffee shop on the way.');
    await sendButton.click();
    await expect(page.getByText('I found Café Corner on your route.')).toBeVisible();
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();
    await expect(page.getByText('15 min stop')).toBeVisible();
    await expect(page.getByText('67 min')).toBeVisible();
    await expect(page.getByText('52 min', { exact: true })).toBeVisible();
    await expect(page.locator('.maplibregl-marker')).toHaveCount(3);
    await page.locator('.maplibregl-marker').nth(2).click();
    await expect(page.getByText('Stop 1: Café Corner')).toBeVisible();

    // Turn 3: Avoid highways
    await input.fill('Avoid highways too.');
    await sendButton.click();
    await expect(page.getByText('I updated the route to avoid highways as well.')).toBeVisible();
    await expect(page.getByText('85 min')).toBeVisible();
    await expect(page.getByText('70 min')).toBeVisible();
    await expect(page.getByText('✓ avoid highways', { exact: true })).toBeVisible();

    // Scenario I: Map container remains mounted throughout
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });

  test('Scenario J: stale route is labeled and keeps the last successful metrics', async ({ page }) => {
    await page.goto('/');

    await page.route('/api/chat', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: "The route recalculation failed, so the previous route is shown as stale.",
          travelPlan: {
            ...basePlan,
            stale: true,
            staleReason: "Routing provider unavailable"
          }
        })
      });
    });

    await page.getByLabel('Message input').fill('Try that again.');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Last successful route — stale.')).toBeVisible();
    await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();
    await expect(page.getByText('Routing provider unavailable')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('52 min', { exact: true })).toBeVisible();
    await expect(page.locator('.maplibregl-marker')).toHaveCount(2);
  });

  test('Scenario E: Retry behavior on server error', async ({ page }) => {
    await page.goto('/');

    let callCount = 0;
    await page.route('/api/chat', async route => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: "Route planning is temporarily unavailable." })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: "Retry succeeded! Route ready.",
            travelPlan: basePlan
          })
        });
      }
    });

    const input = page.getByLabel('Message input');
    const sendButton = page.getByRole('button', { name: 'Send message' });

    await input.fill('Plan my trip');
    await sendButton.click();

    // Error message and retry button should appear
    await expect(page.getByText('Route planning is temporarily unavailable.')).toBeVisible();
    const retryBtn = page.getByRole('button', { name: 'Retry' });
    await expect(retryBtn).toBeVisible();

    // Click retry
    await retryBtn.click();
    await expect(page.getByText('Retry succeeded! Route ready.')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
  });

  test('Scenario F: Example prompt interaction', async ({ page }) => {
    await page.goto('/');

    await page.route('/api/chat', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: "Here is your plan for Pune Airport.",
          travelPlan: basePlan
        })
      });
    });

    const exampleBtn = page.getByRole('button', { name: 'Try example: Get me to Pune Airport by 7 AM and avoid tolls.' });
    await exampleBtn.click();

    await expect(page.getByText('Here is your plan for Pune Airport.')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
  });

  test('Scenario G & H: Voice control UI and accessibility', async ({ page }) => {
    await page.goto('/');

    // Voice button may or may not be active depending on browser speech recognition support
    // When rendered, it has meaningful aria-label
    const micButton = page.getByLabel('Start voice input');
    if (await micButton.count() > 0) {
      await expect(micButton).toBeVisible();
      await expect(micButton).toBeEnabled();
    }

    // Input must always be accessible
    const input = page.getByLabel('Message input');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('Scenario K: contextual actions route through the chat workflow', async ({ page }) => {
    await page.goto('/');

    const sentMessages: string[] = [];
    await page.route('/api/chat', async route => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      const { message } = route.request().postDataJSON();
      sentMessages.push(message);

      if (message === 'Add a coffee stop on the way.') {
        return fulfillJson(route, {
          message: "I found Café Corner on your route. With a 15-minute stop, total time is 67 minutes.",
          travelPlan: cafePlan,
        });
      }
      if (message === 'Avoid highways.') {
        return fulfillJson(route, {
          message: "I updated the route to avoid highways as well.",
          travelPlan: noHighwaysPlan,
        });
      }
      if (message === 'Remove the current stop.') {
        return fulfillJson(route, {
          message: "I removed the coffee stop. The direct route takes 52 minutes.",
          travelPlan: basePlan,
        });
      }
      return fulfillJson(route, { message: "Direct route ready.", travelPlan: basePlan });
    });

    await page.getByLabel('Message input').fill('Get me to Pune Airport by 7 AM and avoid tolls.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Direct route ready.')).toBeVisible();

    await page.getByRole('button', { name: 'Add a coffee stop', exact: true }).click();
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();
    await expect(page.getByText('15 min stop')).toBeVisible();
    expect(sentMessages.at(-1)).toBe('Add a coffee stop on the way.');

    await page.getByRole('button', { name: 'Avoid highways', exact: true }).click();
    await expect(page.getByText('85 min', { exact: true })).toBeVisible();
    await expect(page.getByText('✓ avoid highways', { exact: true })).toBeVisible();
    expect(sentMessages.at(-1)).toBe('Avoid highways.');

    await page.getByRole('button', { name: 'Remove stop', exact: true }).click();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('15 min stop')).toHaveCount(0);
    expect(sentMessages.at(-1)).toBe('Remove the current stop.');
  });

  test('Scenario L: itinerary and map stop selection stay linked', async ({ page }) => {
    await page.goto('/');

    await page.route('/api/chat', async route => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return fulfillJson(route, {
        message: "I found Café Corner on your route.",
        travelPlan: cafePlan,
      });
    });

    await page.getByLabel('Message input').fill('Add a coffee stop.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();

    const stopButton = page.getByRole('button', { name: 'Select stop 1: Café Corner' });
    await stopButton.click();
    await expect(stopButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.map-marker--stop')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Selected stop', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Clear stop selection' }).click();
    await expect(stopButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Selected stop', { exact: true })).toHaveCount(0);

    // Marker click drives the same selection, so the two views cannot drift.
    await page.locator('.map-marker--stop').click();
    await expect(stopButton).toHaveAttribute('aria-pressed', 'true');

    // Conversation collapse keeps the map mounted and restores the composer.
    await page.getByRole('button', { name: 'Collapse conversation' }).click();
    await expect(page.getByRole('button', { name: 'Expand conversation' })).toBeVisible();
    await expect(page.locator('.maplibregl-map')).toBeVisible();
    await page.getByRole('button', { name: 'Expand conversation' }).click();
    await expect(page.getByLabel('Message input')).toBeVisible();
  });

  test('Scenario M: mobile tabs and collapsible trip sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.route('/api/chat', async route => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return fulfillJson(route, {
        message: "I found Café Corner on your route.",
        travelPlan: cafePlan,
      });
    });

    await page.getByLabel('Message input').fill('Add a coffee stop.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('I found Café Corner on your route.')).toBeVisible();

    await expect(page.getByLabel('Chat view')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Map view').click();
    await expect(page.getByLabel('Map view')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#conversation')).toBeHidden();
    await expect(page.locator('#map-workspace')).toBeVisible();

    // The sheet starts collapsed so the map stays dominant on small screens.
    await expect(page.locator('#trip-summary')).toBeHidden();
    await page.getByRole('button', { name: 'Trip details' }).click();
    await expect(page.locator('#trip-summary')).toBeVisible();
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();
    await page.getByRole('button', { name: 'Hide details' }).click();
    await expect(page.locator('#trip-summary')).toBeHidden();

    await page.getByLabel('Chat view').click();
    await expect(page.locator('#conversation')).toBeVisible();
  });
});
