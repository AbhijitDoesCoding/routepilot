import { test, expect } from '@playwright/test';

const basePlan = {
  id: "plan-1",
  origin: { name: "Home", lat: 18.5, lon: 73.8 },
  destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
  departureTime: "2026-10-07T05:58:00Z",
  actualEta: "2026-10-07T06:50:00Z",
  arrivalDeadline: "2026-10-07T07:00:00Z",
  durationMinutes: 52,
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

test.describe('RoutePilot Smoke Tests', () => {
  test('Scenario A & B: E2E Travel Planning Flow', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('h1')).toHaveText('RoutePilot');
    
    const input = page.getByPlaceholder('Where do you want to go?');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    
    await expect(input).toBeVisible();
    await expect(sendButton).toBeDisabled();

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
      } else if (payload.message.includes('highways too')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: "I updated the route to avoid highways as well.",
            travelPlan: {
              ...basePlan,
              id: "plan-2",
              durationMinutes: 70,
              distanceKm: 22.1,
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

    await input.fill('I need to reach Pune Airport by 7 AM and avoid tolls.');
    await sendButton.click();

    await expect(page.getByText('I recommend leaving at 5:58 AM.')).toBeVisible();
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('52 min')).toBeVisible();
    await expect(page.getByText('21.4 km')).toBeVisible();
    await expect(page.getByText('10 min buffer')).toBeVisible();
    await expect(page.getByText('avoid tolls')).toBeVisible();

    await input.fill('Avoid highways too.');
    await sendButton.click();

    await expect(page.getByText('I updated the route to avoid highways as well.')).toBeVisible();
    await expect(page.getByText('70 min')).toBeVisible();
    await expect(page.getByText('22.1 km')).toBeVisible();
    await expect(page.getByText('avoid highways')).toBeVisible();
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });

  test('Scenario C: Stop Planning Flow', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('Where do you want to go?');
    const sendButton = page.getByRole('button', { name: 'Send message' });

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
      } else {
        await route.continue();
      }
    });

    // Turn 1: baseline plan
    await input.fill('I need to reach Pune Airport by 7 AM and avoid tolls.');
    await sendButton.click();
    await expect(page.getByText('I recommend leaving at 5:58 AM.')).toBeVisible();

    // Turn 2: add coffee stop
    await input.fill('Also find a coffee shop on the way.');
    await sendButton.click();

    // Assert assistant response
    await expect(page.getByText('I found Café Corner on your route.')).toBeVisible();

    // Assert route title shows stop
    await expect(page.getByText('Home → Café Corner → Pune Airport')).toBeVisible();

    // Assert stop duration appears
    await expect(page.getByText('15 min stop')).toBeVisible();

    // Assert total duration
    await expect(page.getByText('67 min')).toBeVisible();

    // Assert driving duration
    await expect(page.getByText('52 min')).toBeVisible();

    // Assert buffer
    await expect(page.getByText('5 min buffer')).toBeVisible();

    // Assert constraint badge still present
    await expect(page.getByText('avoid tolls')).toBeVisible();

    // Assert map still mounted
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });
});
