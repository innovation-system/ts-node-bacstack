/* eslint-disable no-unused-vars */
import Client from '../../lib/client';

// Explicit configuration
const CLIENT_PORT = 47809;

// Create a client with debugging information
console.log('Initializing client on port', CLIENT_PORT);
const client = new Client({
  port: CLIENT_PORT, // Different port for the client
  interface: '0.0.0.0', // Listen on all interfaces
  broadcastAddress: '192.168.1.255', // Global broadcast
  apduTimeout: 10000 // Longer timeout
});

// Listen for errors
client.on('error', (err) => {
  console.error('[CLIENT ERROR]', err);
});

// Log the IAm response
client.on('iAm', (device) => {
  console.log('✅ DEVICE FOUND:');
  console.log(`   ID: ${device.deviceId}`);
  console.log(`   Address: ${device.address}`);
  console.log(`   MaxAPDU: ${device.maxApdu}`);
  console.log(`   Segmentation: ${device.segmentation}`);
  console.log(`   Vendor ID: ${device.vendorId}`);
});

// Add listener for all relevant events
client.on('whoIs', (data) => {
  console.log('Received whoIs:', data);
});

// First test - Attempt to localhost
console.log('\nTest 1/3: Explicit WhoIs to localhost...');
client.whoIs({address: '192.168.1.255'});

// Second test after 3 seconds - Attempt with specific ID
setTimeout(() => {
  console.log('\nTest 2/3: WhoIs with specific ID...');
  client.whoIs({
    lowLimit: 389001, // Simulator ID
    highLimit: 389001,
    address: '192.168.1.255'
  });
}, 3000);

// Third test after 6 seconds - Broadcast
setTimeout(() => {
  console.log('\nTest 3/3: WhoIs broadcast...');
  client.whoIs();
}, 6000);

// Terminate after 12 seconds
setTimeout(() => {
  console.log('\nTests completed');
  client.close();
}, 12000);
