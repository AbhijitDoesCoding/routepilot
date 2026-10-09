import { test, expect } from '@playwright/test';

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

test.describe('RoutePilot Alexa+ Simulator E2E Tests', () => {
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
    await expect(page.getByText('52 min')).toBeVisible();
    await expect(page.getByText('21.4 km')).toBeVisible();
    await expect(page.getByText('10 min buffer')).toBeVisible();
    await expect(page.getByText('avoid tolls')).toBeVisible();
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
    await expect(page.getByText('52 min')).toBeVisible();

    // Turn 3: Avoid highways
    await input.fill('Avoid highways too.');
    await sendButton.click();
    await expect(page.getByText('I updated the route to avoid highways as well.')).toBeVisible();
    await expect(page.getByText('85 min')).toBeVisible();
    await expect(page.getByText('70 min')).toBeVisible();
    await expect(page.getByText('avoid highways')).toBeVisible();

    // Scenario I: Map container remains mounted throughout
    await expect(page.locator('.maplibregl-map')).toBeVisible();
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
});
