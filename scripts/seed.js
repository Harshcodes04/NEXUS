/**
 * ════════════════════════════════════════════════════════════════════════
 *  MISSION SEEDER — scripts/seed.js
 *  NSH 2026 Compliance: 55 Satellites | 10,000 Debris Objects
 * ════════════════════════════════════════════════════════════════════════
 */
const http = require('http');

// ── Physical Constants ────────────────────────────────────────────────────────
const MU = 398600.4418;  // km³/s²
const RE = 6378.137;     // km

// ── Keplerian → ECI conversion ───────────────────────────────────────────────
function keplerianToECI(a, e, incDeg, raanDeg, argpDeg, nuDeg) {
  const deg = Math.PI / 180;
  const inc  = incDeg  * deg;
  const raan = raanDeg * deg;
  const argp = argpDeg * deg;
  const nu   = nuDeg   * deg;

  const p     = a * (1 - e * e);
  const r_mag = p / (1 + e * Math.cos(nu));

  // Perifocal frame
  const rx_pf = r_mag * Math.cos(nu);
  const ry_pf = r_mag * Math.sin(nu);
  const vfac  = Math.sqrt(MU / p);
  const vx_pf = -vfac * Math.sin(nu);
  const vy_pf = vfac * (e + Math.cos(nu));

  // Rotation matrix: Rz(-raan) * Rx(-inc) * Rz(-argp)
  const cosO = Math.cos(raan), sinO = Math.sin(raan);
  const cosI = Math.cos(inc),  sinI = Math.sin(inc);
  const cosW = Math.cos(argp), sinW = Math.sin(argp);

  const Q = [
    [cosO*cosW - sinO*sinW*cosI, -cosO*sinW - sinO*cosW*cosI,  sinO*sinI],
    [sinO*cosW + cosO*sinW*cosI, -sinO*sinW + cosO*cosW*cosI, -cosO*sinI],
    [sinW*sinI,                   cosW*sinI,                    cosI     ],
  ];

  const rot = (pf) => [
    Q[0][0]*pf[0] + Q[0][1]*pf[1],
    Q[1][0]*pf[0] + Q[1][1]*pf[1],
    Q[2][0]*pf[0] + Q[2][1]*pf[1],
  ];

  const r = rot([rx_pf, ry_pf]);
  const v = rot([vx_pf, vy_pf]);
  return { r: {x: r[0], y: r[1], z: r[2]}, v: {x: v[0], y: v[1], z: v[2]} };
}

// ── Walker-Delta Constellation ───────────────────────────────────────────────
function generateConstellation() {
  const satellites = [];
  const NUM_PLANES  = 5;
  const SATS_PLANE  = 11;
  const ALT_KM      = 500;         // Nominal altitude
  const INC_DEG     = 55;          // Inclination — covers ±55° latitude
  const a           = RE + ALT_KM; // Semi-major axis
  const e           = 0.0001;      // Near-circular

  const planeNames   = ['Alpha','Beta','Gamma','Delta','Epsilon'];
  const satLetters   = ['01','02','03','04','05','06','07','08','09','10','11'];
  const rng = mulberry32(0xCAFEBABE);

  for (let p = 0; p < NUM_PLANES; p++) {
    const raan = (p * 360 / NUM_PLANES);  // RAAN spacing
    for (let s = 0; s < SATS_PLANE; s++) {
      const nu = (s * 360 / SATS_PLANE) + (p * 360 / (NUM_PLANES * SATS_PLANE));
      const state = keplerianToECI(a, e, INC_DEG, raan, 0, nu);
      const id = `SAT-${planeNames[p]}-${satLetters[s]}`;
      satellites.push({
        id,
        type:     'SATELLITE',
        r:        state.r,
        v:        state.v,
        fuelKg:   parseFloat((10.0 + rng() * 90.0).toFixed(2)), // Distinct fuel levels
        nominalR: { ...state.r },  // Store as nominal slot
      });
    }
  }
  return satellites;
}

// ── Debris Cloud ─────────────────────────────────────────────────────────────
function generateDebris() {
  const debris = [];
  const rng    = mulberry32(0xDEADBEEF);

  // Generates a high-density cloud of 10,000 tracked particles (NSH Spec)
  for (let i = 0; i < 10000; i++) {
    // Random altitude between 380 km and 650 km
    const altKm = 380 + rng() * 270;
    const a     = RE + altKm;
    const e     = rng() * 0.03;  // Slightly elliptical
    const inc   = rng() * 100;   // Wide inclination spread
    const raan  = rng() * 360;
    const argp  = rng() * 360;
    const nu    = rng() * 360;

    const state = keplerianToECI(a, e, inc, raan, argp, nu);
    debris.push({
      id:   `DEB-${String(i + 1).padStart(5, '0')}`,
      type: 'DEBRIS',
      r:    state.r,
      v:    state.v,
    });
  }

  // GUARANTEED THREAT for SAT-Alpha-01
  const sat0 = keplerianToECI(RE + 500, 0.0001, 55, 0, 0, 0);
  debris.push({
    id: `DEB-KILLER-01`,
    type: 'DEBRIS',
    r: { x: sat0.r.x + 1.2, y: sat0.r.y, z: sat0.r.z },
    v: { x: sat0.v.x - 0.5, y: sat0.v.y, z: sat0.v.z },
  });

  return debris;
}

// ── Seeded PRNG (Mulberry32) to ensure reproducible debris ──────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'localhost',
      port:     8000,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(d) });
        } catch (parseErr) {
          reject(new Error(`Invalid JSON from server (HTTP ${res.statusCode}): ${d.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ACM Enhanced Seed Data — Constellation + LEO  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const timestamp = new Date().toISOString();

  const sats   = generateConstellation();
  const debris = generateDebris();

  console.log(`[Seed] Generated ${sats.length} satellites (Walker-Delta 5×10, 500 km, 55° inc)`);
  console.log(`[Seed] Generated ${debris.length} debris pieces (380–650 km LEO)`);

  // Split into batches of 100 to avoid hitting the 50 MB limit
  const allObjects = [...sats, ...debris];
  const BATCH = 100;
  let totalProcessed = 0;

  for (let i = 0; i < allObjects.length; i += BATCH) {
    const batch = allObjects.slice(i, i + BATCH);
    try {
      const res = await post('/api/telemetry', { timestamp, objects: batch });
      if (res.status !== 200) {
        console.error(`[Seed] Batch ${i/BATCH + 1} failed:`, res.body);
      } else {
        totalProcessed += batch.length;
        process.stdout.write(`\r[Seed] Ingested ${totalProcessed}/${allObjects.length} objects...`);
      }
    } catch (err) {
      console.error(`\n[Seed] Error:`, err.message);
    }
  }

  console.log(`\n[Seed] ✓ Done! ${sats.length} satellites + ${debris.length} debris ingested.`);
  console.log('[Seed] You can now open http://localhost:8000 to see the full constellation.');
}

main().catch(console.error);
