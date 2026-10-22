import { test, expect, type Page, type Route } from '@playwright/test';

// Goal E fixture matrix. Every API call is mocked; nothing here touches a live
// provider. Screenshots are written under ignored test-results/ for the report.

const basePlan = {
  id: 'matrix-base',
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
    coordinates: [[73.8, 18.5], [73.84, 18.52], [73.9, 18.57]],
  },
  constraintEvaluations: [
    { type: 'avoid_tolls', severity: 'hard', status: 'satisfied' },
  ],
};

const stopPlan = {
  ...basePlan,
  id: 'matrix-stop',
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

const constrainedPlan = {
  ...basePlan,
  id: 'matrix-constraints',
  constraintEvaluations: [
    { type: 'avoid_tolls', severity: 'hard', status: 'satisfied' },
    { type: 'avoid_highways', severity: 'hard', status: 'satisfied' },
    { type: 'arrive_by', severity: 'hard', status: 'satisfied' },
  ],
};

const fulfill = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockPlan = (page: Page, plan: unknown = null) =>
  page.route('**/api/plan*', (route) => fulfill(route, 200, { travelPlan: plan }));

const mockChat = (page: Page, responder: (message: string) => unknown) =>
  page.route('**/api/chat', async (route) => {
    const { message } = route.request().postDataJSON();
    const result = responder(message) as { status?: number; body: unknown };
    return fulfill(route, result.status ?? 200, result.body);
  });

const send = async (page: Page, text: string) => {
  await page.getByLabel('Message input').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
};

const shot = async (page: Page, viewport: string, name: string) => {
  await page.waitForTimeout(700);
  await page.screenshot({
    path: `test-screenshots/phase2/${viewport}/${name}.png`,
    fullPage: false,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/** Bring the map workspace and the collapsed mobile trip sheet into view. */
const showMap = async (page: Page) => {
  const mapTab = page.getByLabel('Map view');
  if (await mapTab.isVisible()) await mapTab.click();
  const details = page.getByRole('button', { name: 'Trip details' });
  if (await details.isVisible()) await details.click();
};

const planResponder = (plan: unknown, extra?: (message: string) => unknown) => (message: string) =>
  extra?.(message) ?? { body: { message: 'Route ready.', travelPlan: plan } };

test.describe.configure({ mode: 'serial' });

const SIZES = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
];

for (const size of SIZES) {
  test.describe(`fixture matrix ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('routepilot.voice-mode', 'browser');
        } catch {
          // Storage is optional.
        }
        class FakeUtterance {
          text: string;
          onend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          constructor(text: string) {
            this.text = text;
          }
        }
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
          configurable: true,
          value: FakeUtterance,
        });
        Object.defineProperty(window, 'speechSynthesis', {
          configurable: true,
          value: {
            getVoices: () => [{ name: 'Matrix English', lang: 'en-US' }],
            speak: (utterance: FakeUtterance) => {
              setTimeout(() => utterance.onend?.(), 5);
            },
            cancel: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          },
        });
      });
      await mockPlan(page);
    });

    test('01 empty cockpit', async ({ page }) => {
      await page.goto('/');
      // The map lives behind the mobile Map tab; show the empty workspace on
      // narrow screens instead of an intentionally hidden desktop pane.
      const mapTab = page.getByLabel('Map view');
      if (await mapTab.isVisible()) await mapTab.click();
      await expect(page.getByText('Your route will appear here')).toBeVisible();
      await shot(page, size.name, '01-empty');
    });

    test('02 canonical plan', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.locator('#trip-summary')).toContainText('21.4 km');
      await showMap(page);
      await shot(page, size.name, '02-plan');
    });

    test('03 stop and dwell', async ({ page }) => {
      await mockChat(page, planResponder(stopPlan));
      await page.goto('/');
      await send(page, 'Add a coffee stop.');
      await expect(page.locator('#trip-summary')).toContainText('Vohuman Cafe');
      await showMap(page);
      await expect(page.locator('.maplibregl-marker')).toHaveCount(3);
      await shot(page, size.name, '03-stop');
    });

    test('04 constraint badges', async ({ page }) => {
      await mockChat(page, planResponder(constrainedPlan));
      await page.goto('/');
      await send(page, 'Avoid tolls and highways.');
      await expect(page.locator('#trip-summary')).toContainText('21.4 km');
      await showMap(page);
      await expect(page.getByText('Avoid highways', { exact: false }).first()).toBeVisible();
      await shot(page, size.name, '04-constraints');
    });

    test('05 plan updated summary', async ({ page }) => {
      await mockChat(
        page,
        planResponder(stopPlan, (message) =>
          message === 'Plan my trip.'
            ? { body: { message: 'Direct route ready.', travelPlan: basePlan } }
            : undefined,
        ),
      );
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText('Direct route ready.')).toBeVisible();
      await send(page, 'Add a coffee stop.');
      await expect(page.getByText('Plan updated')).toBeVisible();
      await shot(page, size.name, '05-plan-updated');
    });

    test('06 plan unchanged', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText('Route ready.')).toBeVisible();
      await send(page, 'Is this still best?');
      await expect(page.getByText('Plan unchanged')).toBeVisible();
      await shot(page, size.name, '06-plan-unchanged');
    });

    test('07 stale after provider failure', async ({ page }) => {
      let call = 0;
      await mockChat(page, () => {
        call += 1;
        if (call === 1) return { body: { message: 'Route ready.', travelPlan: basePlan } };
        return {
          status: 503,
          body: { error: 'Routing provider is unavailable.', failureKind: 'provider' },
        };
      });
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText('Route ready.')).toBeVisible();
      await send(page, 'Leave later.');
      await expect(page.getByRole('alert')).toContainText('Routing provider is unavailable.');
      if (size.width >= 768) {
        await expect(page.getByText('Last Successful Plan (Stale)')).toBeVisible();
      }
      await shot(page, size.name, '07-stale');
    });

    test('08 first-turn error', async ({ page }) => {
      await mockChat(page, () => ({
        status: 503,
        body: { error: 'Routing provider is unavailable.', failureKind: 'provider' },
      }));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByRole('alert')).toContainText('Routing provider is unavailable.');
      await shot(page, size.name, '08-error');
    });

    test('09 selected stop', async ({ page }) => {
      await mockChat(page, planResponder(stopPlan));
      await page.goto('/');
      await send(page, 'Add a coffee stop.');
      await expect(page.locator('#trip-summary')).toContainText('Vohuman Cafe');
      await showMap(page);
      await expect(page.locator('.maplibregl-marker')).toHaveCount(3);
      // On phones the marker can sit under the floating trip sheet, so invoke
      // the same DOM click without Playwright's viewport hit-testing.
      await page
        .getByLabel('Map marker — Stop 1: Vohuman Cafe')
        .evaluate((element) => (element as HTMLElement).click());
      await expect(page.locator('.maplibregl-marker.is-selected')).toHaveCount(1);
      await shot(page, size.name, '09-selected-stop');
    });

    test('10 collapsed conversation', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.locator('#trip-summary')).toContainText('21.4 km');
      await showMap(page);
      const collapse = page.getByLabel('Collapse conversation');
      if (await collapse.isVisible()) await collapse.click();
      await shot(page, size.name, '10-collapsed');
    });

    test('11 chat view', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      const chatTab = page.getByLabel('Chat view');
      if (await chatTab.isVisible()) await chatTab.click();
      await shot(page, size.name, '11-chat-view');
    });

    test('12 map view', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      const mapTab = page.getByLabel('Map view');
      if (await mapTab.isVisible()) await mapTab.click();
      await expect(page.getByLabel('Route map')).toBeVisible();
      await shot(page, size.name, '12-map-view');
    });

    test('13 browser voice speaking', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'speechSynthesis', {
          configurable: true,
          value: {
            getVoices: () => [{ name: 'Matrix English', lang: 'en-US' }],
            speak: () => {},
            cancel: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          },
        });
      });
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText(/Speaking with browser voice/).first()).toBeVisible();
      await shot(page, size.name, '13-browser-voice');
    });

    test('14 muted voice', async ({ page }) => {
      await mockChat(page, planResponder(basePlan));
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByLabel('Mute voice replies')).toBeVisible();
      await page.getByLabel('Mute voice replies').click();
      await expect(page.getByText('Voice replies muted', { exact: true })).toBeVisible();
      await shot(page, size.name, '14-muted');
    });

    test('15 longer conversation', async ({ page }) => {
      let turn = 0;
      await mockChat(page, () => {
        turn += 1;
        return {
          body: {
            message: `Reply ${turn}: route updated with the latest details.`,
            travelPlan: turn === 1 ? basePlan : stopPlan,
          },
        };
      });
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText(/Reply 1:/)).toBeVisible();
      await send(page, 'Add a coffee stop.');
      await expect(page.getByText(/Reply 2:/)).toBeVisible();
      await send(page, 'Leave later.');
      await expect(page.getByText(/Reply 3:/)).toBeVisible();
      await shot(page, size.name, '15-conversation');
    });

    test('16 loading state', async ({ page }) => {
      await page.route('**/api/chat', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return fulfill(route, 200, { message: 'Route ready.', travelPlan: basePlan });
      });
      await page.goto('/');
      await send(page, 'Plan my trip.');
      await expect(page.getByText('Planning…', { exact: false }).first()).toBeVisible();
      await shot(page, size.name, '16-loading');
    });
  });
}
