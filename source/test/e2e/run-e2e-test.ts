/* eslint-disable valid-jsdoc */
/**
 * BACnet E2E Test Runner
 *
 * This script coordinates running the E2E tests with the BACnet simulator.
 * It starts the simulator, runs the tests, and then stops the simulator.
 */

import {spawn, ChildProcess} from 'child_process';
import {resolve} from 'path';
import {setTimeout as sleep} from 'timers/promises';

// Configuration
const CONFIG = {
  // How long to wait for simulator to start before running tests
  simulatorStartupTime: 3000,
  // How long to wait after tests complete before shutting down
  shutdownDelay: 1000,
  // Whether to keep the simulator running after tests complete
  keepSimulatorRunning: false,
  // Path to simulator script
  simulatorPath: resolve(__dirname, '../bacnet-device-simulator.ts'),
  // Path to Jest binary
  jestPath: resolve(__dirname, '../../node_modules/.bin/jest'),
  // Path to test file
  testPath: resolve(__dirname, './bacnet-e2e.test.ts'),
  // Additional Jest options
  jestOptions: ['--verbose']
};

/**
 * Start the BACnet device simulator
 */
function startSimulator(): ChildProcess {
  console.log('\n🚀 Starting BACnet device simulator...');

  // Use ts-node to run the simulator TypeScript file
  const simulator = spawn('npx', [
    'ts-node',
    CONFIG.simulatorPath
  ], {
    stdio: 'pipe',
    shell: true
  });

  simulator.stdout.on('data', (data) => {
    console.log(`📡 [Simulator] ${data.toString().trim()}`);
  });

  simulator.stderr.on('data', (data) => {
    console.error(`❌ [Simulator Error] ${data.toString().trim()}`);
  });

  simulator.on('close', (code) => {
    if (code !== 0) {
      console.error(`❌ BACnet simulator exited with code ${code}`);
    } else {
      console.log('📡 BACnet simulator has stopped');
    }
  });

  return simulator;
}

/**
 * Run the Jest E2E tests
 */
async function runTests(): Promise<number> {
  console.log('\n🧪 Running BACnet E2E tests...');

  return new Promise((resolve) => {
    const jest = spawn(CONFIG.jestPath, [
      CONFIG.testPath,
      ...CONFIG.jestOptions
    ], {
      stdio: 'inherit',
      shell: true
    });

    jest.on('close', (code) => {
      console.log(`\n${code === 0 ? '✅' : '❌'} Tests completed with exit code ${code}`);
      resolve(code || 0);
    });
  });
}

/**
 * Main runner function
 */
async function run() {
  console.log('📋 BACnet E2E Test Runner\n');

  // Start the simulator
  const simulator = startSimulator();

  // Wait for simulator to initialize
  console.log(`⏳ Waiting ${CONFIG.simulatorStartupTime}ms for simulator to start...`);
  await sleep(CONFIG.simulatorStartupTime);

  // Run the tests
  const testResult = await runTests();

  // Wait a bit before shutting down
  await sleep(CONFIG.shutdownDelay);

  // Shut down the simulator if configured to do so
  if (!CONFIG.keepSimulatorRunning) {
    console.log('\n🛑 Stopping BACnet device simulator...');
    simulator.kill('SIGINT');
  } else {
    console.log('\n📡 Keeping BACnet device simulator running. Press Ctrl+C to stop.');
  }

  // Exit with the test result code
  if (!CONFIG.keepSimulatorRunning) {
    process.exit(testResult);
  }
}

// Run everything
run().catch((error) => {
  console.error('❌ Error running tests:', error);
  process.exit(1);
});
