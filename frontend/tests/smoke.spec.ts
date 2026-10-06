import { test, expect } from '@playwright/test';

test.describe('RoutePilot Smoke Tests', () => {
  test('Scenario A & B: E2E Travel Planning Flow', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    
    // Scenario A: Verify Heading and Initial Request
    await expect(page.locator('h1')).toHaveText('RoutePilot');
    
    const input = page.getByPlaceholder('Where do you want to go?');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    
    await expect(input).toBeVisible();
    await expect(sendButton).toBeDisabled();

    // Mock API response for Turn 1
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
          body: JSON.stringify({
            message: "I recommend leaving at 5:58 AM. The route takes 52 minutes and avoids tolls.",
            travelPlan: {
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
              id: "plan-2",
              origin: { name: "Home", lat: 18.5, lon: 73.8 },
              destination: { name: "Pune Airport", lat: 18.57, lon: 73.9 },
              departureTime: "2026-10-07T05:40:00Z",
              actualEta: "2026-10-07T06:50:00Z",
              arrivalDeadline: "2026-10-07T07:00:00Z",
              durationMinutes: 70, // slower without highways
              distanceKm: 22.1,
              bufferMinutes: 10,
              routeGeometry: {
                type: "LineString",
                coordinates: [[73.8, 18.5], [73.85, 18.55], [73.9, 18.57]]
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

    // Enter Turn 1 message
    await input.fill('I need to reach Pune Airport by 7 AM and avoid tolls.');
    await sendButton.click();

    // Verify Assistant Message appears
    await expect(page.getByText('I recommend leaving at 5:58 AM.')).toBeVisible();

    // Verify Travel Plan Details
    await expect(page.getByText('Home → Pune Airport')).toBeVisible();
    await expect(page.getByText('52 min')).toBeVisible();
    await expect(page.getByText('21.4 km')).toBeVisible();
    await expect(page.getByText('10 min buffer')).toBeVisible();
    
    // Verify Constraint
    await expect(page.getByText('avoid tolls')).toBeVisible();

    // Scenario B: Turn 2 Update
    await input.fill('Avoid highways too.');
    await sendButton.click();

    // Verify Assistant Message updates
    await expect(page.getByText('I updated the route to avoid highways as well.')).toBeVisible();

    // Verify Travel Plan updates
    await expect(page.getByText('70 min')).toBeVisible();
    await expect(page.getByText('22.1 km')).toBeVisible();
    await expect(page.getByText('avoid highways')).toBeVisible();
    
    // Check map elements exist silently using class queries to avoid complex webgl checks
    // The RouteMap component sets up a maplibregl-map class when initialized
    await expect(page.locator('.maplibregl-map')).toBeVisible();
  });
});
