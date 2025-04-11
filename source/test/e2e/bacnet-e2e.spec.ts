/**
 * BACnet E2E Test Suite
 *
 * This test suite performs end-to-end tests of the BACnet protocol implementation
 * against real BACnet devices on the network. It tests device discovery, reading
 * and writing properties, and subscribing to COV notifications.
 */

import Client from '../../lib/client';
import * as baEnum from '../../lib/enum';
import {setTimeout as setTimeoutPromise} from 'timers/promises';

// Configuration for the test environment
const TEST_CONFIG = {
  // IP address of a known BACnet device for testing
  // Update this to a valid device IP on your network
  knownDeviceIp: '192.168.1.255',

  // Known device instance ID (update to match your device)
  knownDeviceId: 389001,

  // Test port (different from standard BACnet port to avoid conflicts)
  clientPort: 47809,

  // Network interface (update to match your network configuration)
  interface: '0.0.0.0',

  // Timeouts
  discoveryTimeout: 10000, // 10 seconds for device discovery
  operationTimeout: 15000, // 15 seconds for other operations

  // Test values for writing
  testAnalogValue: 65.5,
  testBinaryValue: true,

  // Test points - update these to valid points on your device
  analogValuePoint: {
    type: baEnum.ObjectType.ANALOG_VALUE,
    instance: 1
  },
  binaryValuePoint: {
    type: baEnum.ObjectType.BINARY_VALUE,
    instance: 1
  }
};

describe('BACnet E2E Tests', () => {
  // Client instance used for tests
  let client: Client;
  // Discovered device ID during tests
  let discoveredDeviceId: number | null = null;
  // Original values to restore after testing
  let originalAnalogValue: number;

  // Setup client before all tests
  beforeAll(() => {
    client = new Client({
      port: TEST_CONFIG.clientPort,
      interface: TEST_CONFIG.interface,
      broadcastAddress: '127.255.255.255',
      apduTimeout: 6000
    });

    // Add a small delay to ensure client is ready
    return setTimeoutPromise(500);
  });

  // Close client connection after all tests
  afterAll(() => {
    if (client) {
      client.close();
    }
  });

  /**
   * Device Discovery Test
   * This test discovers BACnet devices on the network and verifies
   * that at least one device responds.
   */
  test('should discover devices on the network', async () => {
    expect.assertions(1);

    const devices: number[] = [];

    // Create a promise that resolves when a device is found
    const discoveryPromise = new Promise<void>((resolve) => {
      // Set a listener for device discovery
      client.on('iAm', (device) => {
        console.log(`Discovered device: ID=${device.deviceId}, Address=${device.address}`);
        devices.push(device.deviceId);

        // Store the first discovered device ID for later tests
        if (discoveredDeviceId === null) {
          discoveredDeviceId = device.deviceId;
        }

        // If we find the known device, resolve immediately
        if (device.deviceId === TEST_CONFIG.knownDeviceId) {
          resolve();
        }
      });

      // Broadcast WhoIs to discover devices
      client.whoIs({
        // lowLimit: 389001,
        // highLimit: 389001,
        address: '192.168.1.255'
      });

      setTimeout(() => {
        console.log('Sending broadcast Who-Is...');
        client.whoIs();
      }, 1000);
    });

    // Set a timeout to resolve even if the specific device isn't found
    const timeoutPromise = setTimeoutPromise(TEST_CONFIG.discoveryTimeout).then(() => {
      if (devices.length > 0) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('No devices discovered within timeout period'));
    });

    // Wait for either the device to be found or timeout
    await Promise.race([discoveryPromise, timeoutPromise]);

    // Verify at least one device was found
    expect(devices.length).toBeGreaterThan(0);
  }, TEST_CONFIG.discoveryTimeout + 1000);

  /**
   * Read Property Test
   * Reads a property from a known device and verifies the result.
   */
  test('should read a property from a device', async () => {
    // Skip if no device was discovered
    if (!discoveredDeviceId && !TEST_CONFIG.knownDeviceId) {
      console.warn('Skipping read property test - no device available');
      return;
    }

    const deviceId = discoveredDeviceId || TEST_CONFIG.knownDeviceId;
    const targetIp = TEST_CONFIG.knownDeviceIp;

    // Read device object name property
    const readPropertyPromise = new Promise<any>((resolve, reject) => {
      client.readProperty(
          targetIp,
          {type: baEnum.ObjectType.DEVICE, instance: deviceId},
          baEnum.PropertyIdentifier.OBJECT_NAME,
          {},
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Device object name: ${result.values[0].value}`);
              resolve(result);
            }
          }
      );
    });

    const result = await readPropertyPromise;

    // Verify we got a valid result with a device name
    expect(result).toBeDefined();
    expect(result.values[0].value).toBeDefined();
    expect(typeof result.values[0].value).toBe('string');
    expect(result.values[0].value.length).toBeGreaterThan(0);
  }, TEST_CONFIG.operationTimeout);

  /**
   * Read Multiple Properties Test
   * Reads multiple properties from a device in a single request.
   */
  test('should read multiple properties from a device', async () => {
    // Skip if no device was discovered
    if (!discoveredDeviceId && !TEST_CONFIG.knownDeviceId) {
      console.warn('Skipping read multiple properties test - no device available');
      return;
    }

    const deviceId = discoveredDeviceId || TEST_CONFIG.knownDeviceId;
    const targetIp = TEST_CONFIG.knownDeviceIp;

    // Properties to read
    const propList = [
      {id: baEnum.PropertyIdentifier.OBJECT_NAME},
      {id: baEnum.PropertyIdentifier.OBJECT_TYPE},
      {id: baEnum.PropertyIdentifier.SYSTEM_STATUS},
      {id: baEnum.PropertyIdentifier.VENDOR_NAME}
    ];

    // Create request array with device object
    const requestArray = [{
      objectId: {type: baEnum.ObjectType.DEVICE, instance: deviceId},
      properties: propList
    }];

    // Read properties
    const readPropertiesPromise = new Promise<any>((resolve, reject) => {
      client.readPropertyMultiple(
          targetIp,
          requestArray,
          {},
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              console.log('Read multiple properties response:', JSON.stringify(result, null, 2));
              resolve(result);
            }
          }
      );
    });

    const results = await readPropertiesPromise;

    // Verify we got valid results
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].values.length).toBeGreaterThanOrEqual(propList.length);

    // Extract and check specific values
    const propValues = results[0].values;

    // Object name should be a string
    const nameValue = propValues.find((p: { property: { id: number }; value: Array<{ value: string }> }) => p.property.id === baEnum.PropertyIdentifier.OBJECT_NAME);
    expect(nameValue).toBeDefined();
    expect(nameValue.value[0].value).toBeDefined();
    expect(typeof nameValue.value[0].value).toBe('string');

    // Object type should be DEVICE
    const typeValue = propValues.find((p: { property: { id: number }; value: Array<{ value: { type: number } }> }) => p.property.id === baEnum.PropertyIdentifier.OBJECT_TYPE);
    expect(typeValue).toBeDefined();
    expect(typeValue.value[0].value).toBeDefined();
    expect(typeValue.value[0].value.type).toBe(baEnum.ObjectType.DEVICE);
  }, TEST_CONFIG.operationTimeout);

  /**
   * Write and Read Property Test Cycle
   * Writes a value to a property, then reads it back to verify the write succeeded.
   */
  test('should write and read back a property value', async () => {
    const targetIp = TEST_CONFIG.knownDeviceIp;
    const analogPoint = TEST_CONFIG.analogValuePoint;

    // First read the current value to store it
    const readOriginalPromise = new Promise<number>((resolve, reject) => {
      client.readProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          {},
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              originalAnalogValue = result.values[0].value;
              console.log(`Original analog value: ${originalAnalogValue}`);
              resolve(originalAnalogValue);
            }
          }
      );
    });

    await readOriginalPromise;

    // Now write a new test value
    const testValue = TEST_CONFIG.testAnalogValue;
    const writePromise = new Promise<void>((resolve, reject) => {
      client.writeProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          [{type: baEnum.ApplicationTags.REAL, value: testValue}],
          {},
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Successfully wrote value: ${testValue}`);
              resolve();
            }
          }
      );
    });

    await writePromise;

    // Read back the value to verify
    const readBackPromise = new Promise<number>((resolve, reject) => {
      client.readProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          {},
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Read back value: ${result.values[0].value}`);
              resolve(result.values[0].value);
            }
          }
      );
    });

    const readBackValue = await readBackPromise;

    // Verify the value was written correctly
    expect(readBackValue).toBeCloseTo(testValue, 2);

    // Restore the original value
    const restorePromise = new Promise<void>((resolve, reject) => {
      client.writeProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          [{type: baEnum.ApplicationTags.REAL, value: originalAnalogValue}],
          {},
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Restored original value: ${originalAnalogValue}`);
              resolve();
            }
          }
      );
    });

    await restorePromise;
  }, TEST_CONFIG.operationTimeout * 2);

  /**
   * COV (Change of Value) Subscription Test
   * Subscribes to a property for COV notifications, then changes
   * the property value to trigger notifications.
   */
  test('should receive COV notifications when a value changes', async () => {
    const targetIp = TEST_CONFIG.knownDeviceIp;
    const analogPoint = TEST_CONFIG.analogValuePoint;

    // Read original value
    const readOriginalPromise = new Promise<number>((resolve, reject) => {
      client.readProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          {},
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              originalAnalogValue = result.values[0].value;
              console.log(`Original value for COV test: ${originalAnalogValue}`);
              resolve(originalAnalogValue);
            }
          }
      );
    });

    await readOriginalPromise;

    // Create a promise that resolves when a COV notification is received
    const covNotificationPromise = new Promise<void>((resolve) => {
      // Set up listener for COV notifications
      client.on('covNotify', (data) => {
        console.log('Received COV notification:', JSON.stringify(data, null, 2));
        resolve();
      });
    });

    // Subscribe to COV notifications
    const subscribePromise = new Promise<void>((resolve, reject) => {
      // Use a unique subscription ID
      const subscriptionId = Math.floor(Math.random() * 1000) + 1;

      client.subscribeCOV(
          targetIp,
          analogPoint,
          subscriptionId,
          false, // Don't cancel subscription
          true, // Use confirmed notifications
          60, // Lifetime 60 seconds
          {},
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Successfully subscribed to COV for ${analogPoint.type}.${analogPoint.instance}`);
              resolve();
            }
          }
      );
    });

    await subscribePromise;

    // Now change the value to trigger a COV notification
    const newTestValue = originalAnalogValue + 10.0;
    const writePromise = new Promise<void>((resolve, reject) => {
      client.writeProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          [{type: baEnum.ApplicationTags.REAL, value: newTestValue}],
          {},
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Successfully wrote value to trigger COV: ${newTestValue}`);
              resolve();
            }
          }
      );
    });

    await writePromise;

    // Wait for the COV notification or timeout
    const timeoutPromise = setTimeoutPromise(TEST_CONFIG.operationTimeout)
        .then(() => Promise.reject(new Error('Timeout waiting for COV notification')));

    await Promise.race([covNotificationPromise, timeoutPromise]);

    // Restore the original value
    const restorePromise = new Promise<void>((resolve, reject) => {
      client.writeProperty(
          targetIp,
          analogPoint,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          [{type: baEnum.ApplicationTags.REAL, value: originalAnalogValue}],
          {},
          (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Restored original value: ${originalAnalogValue}`);
              resolve();
            }
          }
      );
    });

    await restorePromise;

    // Test passes if we received the COV notification (if not, the promise would have rejected)
    expect(true).toBe(true);
  }, TEST_CONFIG.operationTimeout * 3);
});
