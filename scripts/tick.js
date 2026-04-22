const http = require('http');

console.log("==========================================");
console.log("⏱️ ORBITAL INSIGHT — ADVANCING SIM CLOCK");
console.log("==========================================\n");

const payload = JSON.stringify({
  step_seconds: 3600 // Advance by 1 hour
});

const req = http.request({
  hostname: 'localhost',
  port: 8000,
  path: '/api/simulate/step',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`✅ Server responded with HTTP ${res.statusCode}`);
    console.log(`🤖 Engine Output: ${data}\n`);
    console.log(`Check your browser dashboard! (http://localhost:8000)`);
  });
});

req.on('error', (err) => {
  console.error('❌ Failed to connect to port 8000. Is the server running?');
});

req.write(payload);
req.end();
