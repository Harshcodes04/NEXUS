const { spawn } = require('child_process');
const http = require('http');

let pythonProcess, nodeProcess;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRequest(path, method, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    let reqData = null;
    if (bodyObj) {
      reqData = JSON.stringify(bodyObj);
      options.headers['Content-Length'] = Buffer.byteLength(reqData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    if (reqData) req.write(reqData);
    req.end();
  });
}

async function runTests() {
  console.log("\n🚀 STARTING E2E INTEGRATION TESTS");
  console.log("==================================\n");

  // 1. Start Python Server
  console.log("[1/3] Starting Python Physics Microservice (Port 8001)...");
  pythonProcess = spawn('python', ['microservices/physics/physics_server.py']);
  pythonProcess.stdout.on('data', data => console.log(`[PYTHON] ${data}`));
  pythonProcess.stderr.on('data', data => console.error(`[PYTHON ERR] ${data}`));
  pythonProcess.on('error', err => { console.error(`[PYTHON FAIL] ${err.message}`); });
  
  // 2. Start Node Server
  console.log("[2/3] Starting Node API / Frontend Server (Port 8000)...");
  nodeProcess = spawn('node', ['app.js']);
  nodeProcess.stdout.on('data', data => console.log(`[NODE] ${data}`));
  nodeProcess.stderr.on('data', data => console.error(`[NODE ERR] ${data}`));
  nodeProcess.on('error', err => { console.error(`[NODE FAIL] ${err.message}`); });

  // Wait for servers to bind
  console.log("[3/3] Waiting 3 seconds for servers to bind...\n");
  await sleep(3000);

  try {
    // --- TEST 1: HEALTH ---
    console.log("------------------------------------------");
    console.log("➡️  GET /health");
    const res1 = await makeRequest('/health', 'GET');
    console.log(`Status: ${res1.status}`);
    console.log("Body:");
    console.log(JSON.stringify(JSON.parse(res1.data), null, 2));

    // --- TEST 2: TELEMETRY INGESTION ---
    console.log("\n------------------------------------------");
    console.log("➡️  POST /api/telemetry");
    const payload = {
      timestamp: "2026-03-12T08:00:00.000Z",
      objects: [
        {"id":"SAT-Alpha-01","type":"SATELLITE","r":{"x":4500.2,"y":-2100.5,"z":4800.1},"v":{"x":-1.25,"y":6.84,"z":3.12}},
        {"id":"DEB-99421","type":"DEBRIS","r":{"x":4500.3,"y":-2100.4,"z":4800.0},"v":{"x":-1.26,"y":6.85,"z":3.13}}
      ]
    };
    const res2 = await makeRequest('/api/telemetry', 'POST', payload);
    console.log(`Status: ${res2.status}`);
    console.log("Body:");
    console.log(JSON.stringify(JSON.parse(res2.data), null, 2));

    // --- TEST 3: SIMULATE STEP ---
    console.log("\n------------------------------------------");
    console.log("➡️  POST /api/simulate/step (3600s)");
    const stepPayload = { step_seconds: 3600 };
    const res3 = await makeRequest('/api/simulate/step', 'POST', stepPayload);
    console.log(`Status: ${res3.status}`);
    console.log("Body:");
    console.log(JSON.stringify(JSON.parse(res3.data), null, 2));

    // --- TEST 4: SNAPSHOT ---
    console.log("\n------------------------------------------");
    console.log("➡️  GET /api/visualization/snapshot");
    const res4 = await makeRequest('/api/visualization/snapshot', 'GET');
    console.log(`Status: ${res4.status}`);
    const snap = JSON.parse(res4.data);
    console.log("Body (Truncated):");
    console.log(`{ timestamp: "${snap.timestamp}", satellites: [${snap.satellites.length} objects], debris_cloud: [${snap.debris_cloud.length} objects] }`);
    
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  } finally {
    console.log("\n==========================================");
    console.log("🛑 TEARING DOWN SERVERS...");
    if (pythonProcess) pythonProcess.kill();
    if (nodeProcess) nodeProcess.kill();
    console.log("✅ Tests Completed.");
    process.exit(0);
  }
}

runTests();
