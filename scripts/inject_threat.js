/**
 * ══════════════════════════════════════════════════════════════════════════
 *  DEMO THREAT INJECTOR — scripts/inject_threat.js  (v4 — instant CPA)
 *
 *  Strategy:
 *   • Place debris at sat.r + 0.05 km perpendicular offset (50 m away)
 *   • Same velocity as sat → relative speed = 0 → debris stays near sat
 *   • Distance = 0.05 km < 0.1 km critical threshold → CRITICAL CDM instantly
 *   • Decision engine sees CDM, schedules evasion burn at sim_time + 15 s
 *   • Next 10-second tick: burn fires → satellite moves prograde → fuel deducted
 *   • Repeat inject every 10 minutes to force periodic burns during demo
 * ══════════════════════════════════════════════════════════════════════════
 */
const http = require('http');

const TARGETS = [
  'SAT-Alpha-01',
  'SAT-Alpha-03',
  'SAT-Beta-01',
  'SAT-Gamma-01',
  'SAT-Delta-01',
];

const MISS_OFFSET_KM = 0.05; // 50 m — well inside 0.1 km critical threshold

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: 8000, path }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: '127.0.0.1', port: 8000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Unit vector of v */
function unit(v) {
  const mag = Math.sqrt(v.x**2 + v.y**2 + v.z**2);
  return { x: v.x/mag, y: v.y/mag, z: v.z/mag };
}

/** A perpendicular unit vector (radial approximation) */
function radialPerp(r, v) {
  // r hat (radial direction — points away from Earth centre)
  const rmag = Math.sqrt(r.x**2 + r.y**2 + r.z**2);
  return { x: r.x/rmag, y: r.y/rmag, z: r.z/rmag };
}

function add(a, b) { return { x: a.x+b.x, y: a.y+b.y, z: a.z+b.z }; }
function scale(v, s) { return { x: v.x*s, y: v.y*s, z: v.z*s }; }

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   ACM Demo Threat Injector — Instant CPA Mode (v4)   ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  let snapshot;
  try {
    snapshot = await get('/api/visualization/snapshot');
  } catch(e) {
    console.error('[Error] Cannot reach API at localhost:8000:', e.message);
    process.exit(1);
  }

  const sats   = snapshot.satellites || [];
  const debris = [];

  for (const targetId of TARGETS) {
    const sat = sats.find(s => s.id === targetId);
    if (!sat?.r || !sat?.v) { console.warn(`[Skip] ${targetId} not in snapshot`); continue; }

    // Offset in the RADIAL direction (away from Earth) — 50 m
    const rHat = radialPerp(sat.r, sat.v);
    const debrisR = add(sat.r, scale(rHat, MISS_OFFSET_KM));

    // Same velocity as the satellite — stays permanently close for demo clarity
    const debrisV = { ...sat.v };

    const id = `DEB-CRIT-${targetId.replace('SAT-', '')}`;
    debris.push({ id, type: 'DEBRIS', r: debrisR, v: debrisV });

    console.log(`[+] ${targetId} → ${id}  (dist: ${MISS_OFFSET_KM*1000} m radially above)`);
  }

  if (!debris.length) {
    console.error('[Error] No targets found. Run seed.js first.');
    process.exit(1);
  }

  const res = await post('/api/telemetry', {
    timestamp: new Date().toISOString(),
    objects: debris,
  });

  if (res.status === 200) {
    console.log(`\n✓ Injected ${debris.length} CRITICAL threats (distance = ${MISS_OFFSET_KM*1000} m)!`);
    console.log('  CDMs appear on the NEXT sim tick (within 10 real-seconds).');
    console.log('  Evasion burns fire at sim_time + 15 s (within 1–2 ticks).');
    console.log('  Fuel gauges drop ~1.87 kg per evasion burn.');
    console.log('\n  Dashboard → http://localhost:8000');
  } else {
    console.error('[Error] HTTP', res.status, res.body);
  }
}

main().catch(console.error);
