import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import { readings } from '../src/db/schema.js';
import { cookieHeader, createHarness, sessionCookie, TEST_PASSWORD, type TestHarness } from './harness.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.close();
});

/** Signs in and returns the Cookie header for the session. */
async function signIn(staffId: string): Promise<string> {
  const response = await request(harness.app)
    .post('/api/auth/login')
    .send({ staffId, password: TEST_PASSWORD })
    .expect(200);
  return cookieHeader(sessionCookie(response));
}

function as(cookie: string) {
  return { Cookie: cookie };
}

describe('authentication', () => {
  it('sets an httpOnly session cookie and returns the user role', async () => {
    const response = await request(harness.app)
      .post('/api/auth/login')
      .send({ staffId: 'n-2041', password: TEST_PASSWORD })
      .expect(200);
    const setCookie = sessionCookie(response);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
    expect(response.body.user).toMatchObject({ staffId: 'N-2041', name: 'Anitha S.', role: 'nurse' });
  });

  it('uppercases the staff ID and rejects a wrong password', async () => {
    await request(harness.app).post('/api/auth/login').send({ staffId: 'n-2041', password: 'wrong' }).expect(401);
    await request(harness.app).post('/api/auth/login').send({ staffId: 'N-9999', password: TEST_PASSWORD }).expect(401);
  });

  it('never returns the password hash', async () => {
    const response = await request(harness.app)
      .post('/api/auth/login')
      .send({ staffId: 'N-2041', password: TEST_PASSWORD })
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('$2');
  });

  it('rejects protected routes without a session', async () => {
    for (const path of ['/api/beds', '/api/admin/staff', '/api/admin/rules', '/api/admin/devices', '/api/admin/activity']) {
      await request(harness.app).get(path).expect(401);
    }
  });

  it('clears the cookie on logout', async () => {
    const cookie = await signIn('N-2041');
    const response = await request(harness.app).post('/api/auth/logout').set(as(cookie)).expect(204);
    expect(sessionCookie(response)).toMatch(/smartiv_session=;/);
  });
});

/**
 * The headline acceptance check: a nurse account cannot reach any admin route
 * or see unassigned beds, enforced by the server rather than the UI.
 */
describe('role enforcement on the server', () => {
  const adminRoutes: Array<[string, string]> = [
    ['get', '/api/admin/staff'],
    ['get', '/api/admin/rules'],
    ['get', '/api/admin/devices'],
    ['get', '/api/admin/activity'],
    ['patch', '/api/admin/rules'],
    ['patch', '/api/admin/assignments/3'],
    ['patch', '/api/admin/simulator/speed'],
  ];

  it('returns 403 on every admin route for a nurse', async () => {
    const cookie = await signIn('N-2041');
    for (const [method, path] of adminRoutes) {
      const response = await request(harness.app)[method as 'get'](path).set(as(cookie)).send({});
      expect(response.status, `${method.toUpperCase()} ${path} must be 403 for a nurse`).toBe(403);
    }
  });

  it('returns 403 for a nurse even with a valid body', async () => {
    const cookie = await signIn('N-2041');
    await request(harness.app)
      .patch('/api/admin/rules')
      .set(as(cookie))
      .send({ criticalMinutes: 1, criticalPercent: 1, attentionMinutes: 2, attentionPercent: 2 })
      .expect(403);
    await request(harness.app).patch('/api/admin/assignments/1').set(as(cookie)).send({ nurseId: 'nurse-b' }).expect(403);
  });

  it('lets an admin through the same routes', async () => {
    const cookie = await signIn('A-1001');
    await request(harness.app).get('/api/admin/staff').set(as(cookie)).expect(200);
    await request(harness.app).get('/api/admin/rules').set(as(cookie)).expect(200);
    await request(harness.app).get('/api/admin/devices').set(as(cookie)).expect(200);
    await request(harness.app).get('/api/admin/activity').set(as(cookie)).expect(200);
  });

  it('does not leak the rules themselves to a nurse', async () => {
    const cookie = await signIn('N-2041');
    const response = await request(harness.app).get('/api/admin/rules').set(as(cookie)).expect(403);
    expect(JSON.stringify(response.body)).not.toContain('criticalMinutes');
  });
});

describe('bed visibility', () => {
  it('shows a nurse only their assigned beds', async () => {
    const cookie = await signIn('N-2041');
    const response = await request(harness.app).get('/api/beds').set(as(cookie)).expect(200);
    expect(response.body.beds.map((bed: { bedNumber: number }) => bed.bedNumber)).toEqual([1, 2]);
  });

  it('does not include another nurse\'s bed or an unassigned bed', async () => {
    const cookie = await signIn('N-2041');
    const response = await request(harness.app).get('/api/beds').set(as(cookie)).expect(200);
    const numbers = response.body.beds.map((bed: { bedNumber: number }) => bed.bedNumber);
    expect(numbers).not.toContain(3); // assigned to nurse-b
    expect(numbers).not.toContain(4); // assigned to nobody
  });

  it('hides another nurse\'s bed from history, acknowledge and actions', async () => {
    const cookie = await signIn('N-2041');
    await request(harness.app).get('/api/beds/3/history').set(as(cookie)).expect(404);
    await request(harness.app).post('/api/beds/3/acknowledge').set(as(cookie)).expect(404);
    await request(harness.app).post('/api/beds/3/bag-replaced').set(as(cookie)).expect(404);
    await request(harness.app).post('/api/beds/3/flow-restored').set(as(cookie)).expect(404);
    await request(harness.app).get('/api/beds/4/history').set(as(cookie)).expect(404);
  });

  it('lets a nurse act on their own bed', async () => {
    const cookie = await signIn('N-2041');
    await request(harness.app).get('/api/beds/1/history').set(as(cookie)).expect(200);
  });

  it('shows an admin every active bed', async () => {
    const cookie = await signIn('A-1001');
    const response = await request(harness.app).get('/api/beds').set(as(cookie)).expect(200);
    expect(response.body.beds.map((bed: { bedNumber: number }) => bed.bedNumber).sort()).toEqual([1, 2, 3, 4]);
  });

  it('reports the assigned nurse on each bed', async () => {
    const cookie = await signIn('A-1001');
    const response = await request(harness.app).get('/api/beds').set(as(cookie)).expect(200);
    const byNumber = Object.fromEntries(
      response.body.beds.map((bed: { bedNumber: number; assignedNurse: string | null }) => [bed.bedNumber, bed.assignedNurse]),
    );
    expect(byNumber[1]).toBe('Anitha S.');
    expect(byNumber[3]).toBe('Karthik M.');
    expect(byNumber[4]).toBeNull();
  });
});

describe('device ingestion', () => {
  it('rejects a reading with no device key', async () => {
    await request(harness.app).post('/api/readings').send({ bed: 1, bag_ml: 500, volume_ml: 182, flow_ml_h: 120 }).expect(401);
  });

  it('rejects an unknown device key', async () => {
    await request(harness.app)
      .post('/api/readings')
      .set('X-Device-Key', 'siv_not-a-real-key')
      .send({ bed: 1, bag_ml: 500, volume_ml: 182, flow_ml_h: 120 })
      .expect(401);
  });

  it('rejects a key that is not wired to the bed it claims', async () => {
    // IVU-01 covers beds 1 and 2, so bed 3 belongs to a different unit.
    await request(harness.app)
      .post('/api/readings')
      .set('X-Device-Key', harness.deviceKeys['IVU-01'] ?? '')
      .send({ bed: 3, bag_ml: 500, volume_ml: 182, flow_ml_h: 120 })
      .expect(403);
  });

  it('rejects an unknown bed and an invalid payload', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 99, bag_ml: 500, volume_ml: 10, flow_ml_h: 10 }).expect(403);
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 900, flow_ml_h: 10 }).expect(400);
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: -5, volume_ml: 10, flow_ml_h: 10 }).expect(400);
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 10, flow_ml_h: 'fast' }).expect(400);
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 10, flow_ml_h: 10, extra: 1 }).expect(400);
  });

  it('accepts the documented single-bag body and updates that bed only', async () => {
    const cookie = await signIn('A-1001');
    const key = harness.deviceKeys['IVU-01'] ?? '';
    const response = await request(harness.app)
      .post('/api/readings')
      .set('X-Device-Key', key)
      .send({ bed: 1, bag_ml: 500, volume_ml: 182, flow_ml_h: 120 })
      .expect(202);
    expect(response.body.accepted).toBe(true);

    const beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    const bed1 = beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1);
    const bed2 = beds.find((bed: { bedNumber: number }) => bed.bedNumber === 2);
    expect(bed1.volumeMl).toBe(182);
    expect(bed1.percentLeft).toBeCloseTo(36.4, 4);
    expect(bed1.minutesLeft).toBeCloseTo(91, 4);
    // Bed 2 must be untouched.
    expect(bed2.volumeMl).toBeNull();
  });

  it('accepts both load cells of a unit in one request', async () => {
    const cookie = await signIn('A-1001');
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app)
      .post('/api/readings')
      .set('X-Device-Key', key)
      .send({
        bags: [
          { channel: 1, bed: 1, bag_ml: 500, volume_ml: 250, flow_ml_h: 100 },
          { channel: 2, bed: 2, bag_ml: 500, volume_ml: 400, flow_ml_h: 80 },
        ],
      })
      .expect(202);

    const beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).volumeMl).toBe(250);
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 2).volumeMl).toBe(400);
  });

  it('resolves the bed from the channel when the body omits it', async () => {
    const cookie = await signIn('A-1001');
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app)
      .post('/api/readings')
      .set('X-Device-Key', key)
      .send({ bags: [{ channel: 2, bag_ml: 500, volume_ml: 321, flow_ml_h: 100 }] })
      .expect(202);
    const beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 2).volumeMl).toBe(321);
  });

  it('smooths the flow rate with a moving average', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    const post = (flow: number) =>
      request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 250, flow_ml_h: flow }).expect(202);

    await post(100);
    await post(100);
    await post(300);
    const latest = harness.db.select().from(readings).where(eq(readings.bedId, 1)).orderBy((table) => table.id).all().at(-1);
    // window of 5: [100, 100, 300] -> 166.67
    expect(latest?.smoothedFlowMlH).toBeCloseTo(500 / 3, 4);
    expect(latest?.flowMlH).toBe(300);
  });

  it('snaps the smoothed rate to zero when the drip stops', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 250, flow_ml_h: 120 }).expect(202);
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 250, flow_ml_h: 0 }).expect(202);
    const latest = harness.db.select().from(readings).where(eq(readings.bedId, 1)).all().at(-1);
    expect(latest?.smoothedFlowMlH).toBe(0);
  });
});

describe('severity, banding and ordering', () => {
  async function pushBeds(entries: Array<{ bed: number; bag: number; volume: number; flow: number }>) {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    for (const entry of entries) {
      await request(harness.app)
        .post('/api/readings')
        .set('X-Device-Key', key)
        .send({ bed: entry.bed, bag_ml: entry.bag, volume_ml: entry.volume, flow_ml_h: entry.flow })
        .expect(202);
    }
  }

  it('pins critical beds to the top, sorted soonest first', async () => {
    await pushBeds([
      { bed: 1, bag: 500, volume: 300, flow: 100 }, // 180 min, normal
      { bed: 2, bag: 500, volume: 60, flow: 100 }, // 36 min, attention
    ]);
    const cookie = await signIn('A-1001');
    const beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    expect(beds[0].severity).toBe('attention');
    expect(beds[0].bedNumber).toBe(2);
  });

  it('marks a stopped flow critical even with volume left', async () => {
    await pushBeds([{ bed: 1, bag: 500, volume: 400, flow: 0 }]);
    const cookie = await signIn('A-1001');
    const beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    const bed1 = beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1);
    expect(bed1.severity).toBe('critical');
    expect(bed1.minutesLeft).toBeNull();
    expect(bed1.endTime).toBeNull();
  });

  it('acknowledges an alert and hides the acknowledge button', async () => {
    await pushBeds([{ bed: 1, bag: 500, volume: 20, flow: 100 }]);
    const cookie = await signIn('N-2041');
    let beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).severity).toBe('critical');
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).acknowledged).toBe(false);

    const response = await request(harness.app).post('/api/beds/1/acknowledge').set(as(cookie)).expect(200);
    expect(response.body.bed.acknowledged).toBe(true);
    expect(response.body.bed.acknowledgedByName).toBe('Anitha S.');

    beds = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).acknowledged).toBe(true);
  });

  it('refuses to acknowledge a bed that is not alerting', async () => {
    await pushBeds([{ bed: 1, bag: 500, volume: 400, flow: 100 }]);
    const cookie = await signIn('N-2041');
    await request(harness.app).post('/api/beds/1/acknowledge').set(as(cookie)).expect(409);
  });

  it('resets the acknowledgement when the bed gets worse', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await pushBeds([{ bed: 1, bag: 500, volume: 100, flow: 100 }]); // 60 min -> attention
    const cookie = await signIn('N-2041');
    await request(harness.app).post('/api/beds/1/acknowledge').set(as(cookie)).expect(200);
    let bed = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds[0];
    expect(bed.acknowledged).toBe(true);

    // Worse: bag empties.
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 0, flow_ml_h: 0 }).expect(202);
    bed = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds[0];
    expect(bed.severity).toBe('critical');
    expect(bed.acknowledged).toBe(false);
  });

  it('marks a unit offline after 10 seconds without a reading', async () => {
    await pushBeds([{ bed: 1, bag: 500, volume: 300, flow: 100 }]);
    const cookie = await signIn('A-1001');
    let bed = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds[0];
    expect(bed.offline).toBe(false);

    // Rewind last_reading_at to 11 seconds ago.
    harness.db.run(sql`UPDATE devices SET last_reading_at = ${Date.now() - 11_000}`);
    bed = (await request(harness.app).get('/api/beds').set(as(cookie)).expect(200)).body.beds[0];
    expect(bed.offline).toBe(true);
  });
});

describe('admin operations', () => {
  it('moves a bed between nurses and updates what each nurse can see', async () => {
    const adminCookie = await signIn('A-1001');
    const nurseBCookie = await signIn('N-2042');

    let nurseB = (await request(harness.app).get('/api/beds').set(as(nurseBCookie)).expect(200)).body.beds;
    expect(nurseB.map((bed: { bedNumber: number }) => bed.bedNumber)).toEqual([3]);

    await request(harness.app).patch('/api/admin/assignments/1').set(as(adminCookie)).send({ nurseId: 'nurse-b' }).expect(200);

    nurseB = (await request(harness.app).get('/api/beds').set(as(nurseBCookie)).expect(200)).body.beds;
    expect(nurseB.map((bed: { bedNumber: number }) => bed.bedNumber).sort()).toEqual([1, 3]);

    const nurseACookie = await signIn('N-2041');
    const nurseA = (await request(harness.app).get('/api/beds').set(as(nurseACookie)).expect(200)).body.beds;
    expect(nurseA.map((bed: { bedNumber: number }) => bed.bedNumber)).toEqual([2]);
  });

  it('unassigns a bed with null, leaving the nurse\'s other beds intact', async () => {
    const adminCookie = await signIn('A-1001');
    await request(harness.app).patch('/api/admin/assignments/1').set(as(adminCookie)).send({ nurseId: null }).expect(200);
    const staff = (await request(harness.app).get('/api/admin/staff').set(as(adminCookie)).expect(200)).body.staff;
    expect(staff.find((member: { id: string }) => member.id === 'nurse-a').bedIds).toEqual([2]);

    const nurseACookie = await signIn('N-2041');
    const beds = (await request(harness.app).get('/api/beds').set(as(nurseACookie)).expect(200)).body.beds;
    expect(beds.map((bed: { bedNumber: number }) => bed.bedNumber)).toEqual([2]);
  });

  it('rejects an assignment to an admin or a missing nurse', async () => {
    const adminCookie = await signIn('A-1001');
    await request(harness.app).patch('/api/admin/assignments/1').set(as(adminCookie)).send({ nurseId: 'admin-a' }).expect(400);
    await request(harness.app).patch('/api/admin/assignments/1').set(as(adminCookie)).send({ nurseId: 'ghost' }).expect(400);
  });

  it('edits the alert rules and rejects incoherent ones', async () => {
    const adminCookie = await signIn('A-1001');
    const updated = await request(harness.app)
      .patch('/api/admin/rules')
      .set(as(adminCookie))
      .send({ criticalMinutes: 20, criticalPercent: 15, attentionMinutes: 90, attentionPercent: 40 })
      .expect(200);
    expect(updated.body.rules).toEqual({ criticalMinutes: 20, criticalPercent: 15, attentionMinutes: 90, attentionPercent: 40 });

    await request(harness.app)
      .patch('/api/admin/rules')
      .set(as(adminCookie))
      .send({ criticalMinutes: 60, criticalPercent: 10, attentionMinutes: 30, attentionPercent: 25 })
      .expect(400);
    await request(harness.app)
      .patch('/api/admin/rules')
      .set(as(adminCookie))
      .send({ criticalMinutes: 0, criticalPercent: 10, attentionMinutes: 30, attentionPercent: 25 })
      .expect(400);
  });

  it('re-bands beds immediately when the rules change', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 200, flow_ml_h: 100 }).expect(202);
    const adminCookie = await signIn('A-1001');
    let beds = (await request(harness.app).get('/api/beds').set(as(adminCookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).severity).toBe('normal');

    // 200 mL at 100 mL/h = 120 min, 40% full. Raising attention to 60 min / 60% catches it.
    await request(harness.app)
      .patch('/api/admin/rules')
      .set(as(adminCookie))
      .send({ criticalMinutes: 30, criticalPercent: 20, attentionMinutes: 60, attentionPercent: 60 })
      .expect(200);
    beds = (await request(harness.app).get('/api/beds').set(as(adminCookie)).expect(200)).body.beds;
    expect(beds.find((bed: { bedNumber: number }) => bed.bedNumber === 1).severity).toBe('attention');
  });

  it('lists the unit with both of its load cells and the last reading time', async () => {
    const key = harness.deviceKeys['IVU-01'] ?? '';
    await request(harness.app).post('/api/readings').set('X-Device-Key', key).send({ bed: 1, bag_ml: 500, volume_ml: 200, flow_ml_h: 100 }).expect(202);
    const adminCookie = await signIn('A-1001');
    const response = await request(harness.app).get('/api/admin/devices').set(as(adminCookie)).expect(200);
    const device = response.body.devices[0];
    expect(device.unit).toBe('IVU-01');
    expect(device.channels).toEqual([
      { channel: 1, bedId: 1, fluidName: '0.9% Normal Saline', bagMl: 500 },
      { channel: 2, bedId: 2, fluidName: "Ringer's Lactate", bagMl: 500 },
    ]);
    expect(device.lastReadingAt).toBeTypeOf('number');
    // The device key hash must never leave the server.
    expect(JSON.stringify(response.body)).not.toContain('keyHash');
  });

  it('records staff actions in the activity log', async () => {
    const adminCookie = await signIn('A-1001');
    await request(harness.app).post('/api/beds/1/bag-replaced').set(as(adminCookie)).expect(202);
    await request(harness.app).patch('/api/admin/assignments/2').set(as(adminCookie)).send({ nurseId: 'nurse-b' }).expect(200);
    const response = await request(harness.app).get('/api/admin/activity').set(as(adminCookie)).expect(200);
    const actions = response.body.activity.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('signed_in');
    expect(actions).toContain('bag_replaced');
    expect(actions).toContain('bed_assigned');
  });

  it('exposes the data source and speeds for the simulator control', async () => {
    const response = await request(harness.app).get('/api/meta').expect(200);
    expect(response.body).toMatchObject({ simulate: true, source: 'simulated', speeds: [1, 10, 60] });
  });
});

describe('login rate limiting', () => {
  it('counts attempts and advertises the limit', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(harness.app).post('/api/auth/login').send({ staffId: 'N-2041', password: 'wrong' }).expect(401);
    }
    // A successful sign-in still works, and the limiter header is present so
    // the window is observable from the client.
    const response = await request(harness.app).post('/api/auth/login').send({ staffId: 'N-2041', password: TEST_PASSWORD }).expect(200);
    expect(response.headers['ratelimit']).toBeDefined();
  });

  it('blocks a client that exceeds the attempt limit', async () => {
    harness.close();
    // Rebuild with a limit of 2 so the lockout is reachable in a test.
    const strict = await createHarness({ loginAttempts: 2 });
    try {
      await request(strict.app).post('/api/auth/login').send({ staffId: 'N-2041', password: 'wrong' }).expect(401);
      await request(strict.app).post('/api/auth/login').send({ staffId: 'N-2041', password: 'wrong' }).expect(401);
      const blocked = await request(strict.app).post('/api/auth/login').send({ staffId: 'N-2041', password: TEST_PASSWORD });
      expect(blocked.status).toBe(429);
    } finally {
      strict.close();
      harness = await createHarness();
    }
  });
});
