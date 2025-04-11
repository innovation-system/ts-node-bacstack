/* eslint-disable valid-jsdoc */
/**
 * BACnet E2E Test Configuration
 *
 * This file contains configuration options for the E2E tests.
 * Edit this file to customize the test environment.
 */

export const E2E_CONFIG = {
  // Test environment
  environment: {
    // Whether to use a real device or the simulator
    useRealDevice: false,
    // Maximum timeout for entire test suite (ms)
    testTimeout: 60000,
    // Delay between test operations (ms)
    operationDelay: 500
  },

  // BACnet client configuration
  client: {
    port: 47809,
    interface: '0.0.0.0',
    broadcastAddress: '192.168.1.255',
    apduTimeout: 10000
  },

  // Real device configuration (if useRealDevice is true)
  realDevice: {
    ipAddress: '192.168.1.100',
    deviceId: 123456,
    // Points to test on the real device
    analogValuePoint: {
      type: 2, // ANALOG_VALUE
      instance: 1
    },
    binaryValuePoint: {
      type: 5, // BINARY_VALUE
      instance: 1
    }
  },

  // Simulator configuration (if useRealDevice is false)
  simulator: {
    ipAddress: '192.168.1.255',
    port: 47808,
    deviceId: 389001,
    // Simulated points match those defined in the simulator
    analogValuePoint: {
      type: 2, // ANALOG_VALUE
      instance: 1
    },
    binaryValuePoint: {
      type: 5, // BINARY_VALUE
      instance: 1
    }
  },

  // Test values
  testValues: {
    analogValue: 65.5,
    binaryValue: true
  }
};

/**
   * Get the active device configuration based on the environment setting
   */
export function getActiveDeviceConfig() {
  return E2E_CONFIG.environment.useRealDevice ?
      E2E_CONFIG.realDevice :
      E2E_CONFIG.simulator;
}
