/* eslint-disable valid-jsdoc */
/**
 * BACnet Device Simulator
 *
 * This script simulates a BACnet device for testing purposes.
 * It responds to Who-Is, Read-Property, Write-Property and COV requests.
 */

import Client from '../../../source/lib/client';
import * as baEnum from '../../../source/lib/enum';

process.env.DEBUG = 'bacstack';

// Configuration for the simulator
const SIMULATOR_CONFIG = {
  // BACnet device properties
  deviceId: 389001,
  vendorId: 15,
  modelName: 'BACnet Test Device',
  deviceName: 'BACnet-Simulator',

  // Network configuration
  port: 47808, // Standard BACnet port
  interface: '0.0.0.0',
  broadcastAddress: '192.168.1.255',

  // Simulated points
  points: {
    analogValue1: {
      type: baEnum.ObjectType.ANALOG_VALUE,
      instance: 1,
      properties: {
        [baEnum.PropertyIdentifier.OBJECT_NAME]: 'Analog Value 1',
        [baEnum.PropertyIdentifier.PRESENT_VALUE]: 72.5,
        [baEnum.PropertyIdentifier.DESCRIPTION]: 'Test Analog Value',
        [baEnum.PropertyIdentifier.STATUS_FLAGS]: {bits: [0, 0, 0, 0]},
        [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: false,
        [baEnum.PropertyIdentifier.UNITS]: baEnum.EngineeringUnits.DEGREES_FAHRENHEIT
      }
    },
    binaryValue1: {
      type: baEnum.ObjectType.BINARY_VALUE,
      instance: 1,
      properties: {
        [baEnum.PropertyIdentifier.OBJECT_NAME]: 'Binary Value 1',
        [baEnum.PropertyIdentifier.PRESENT_VALUE]: false,
        [baEnum.PropertyIdentifier.DESCRIPTION]: 'Test Binary Value',
        [baEnum.PropertyIdentifier.STATUS_FLAGS]: {bits: [0, 0, 0, 0]},
        [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: false
      }
    }
  },

  // Active COV subscriptions
  subscriptions: [] as Array<{
    address: string;
    subscriptionProcessId: number;
    monitoredObjectId: {
      type: number;
      instance: number;
    };
    issueConfirmedNotifications: boolean;
    lifetime: number;
    timestamp: Date;
  }>
};

class BacnetDeviceSimulator {
  private client: Client;
  private data: typeof SIMULATOR_CONFIG.points;
  private deviceProps: Record<number, any>;
  private subscriptions: any[] = [];

  constructor(config: typeof SIMULATOR_CONFIG) {
    this.client = new Client({
      port: config.port,
      interface: '0.0.0.0',
      broadcastAddress: config.broadcastAddress,
      apduTimeout: 6000
    });

    this.client.on('error', (err) => {
      console.error('SIMULATORE ERROR:', err);
    });

    this.data = {...config.points};

    // Initialize device properties
    this.deviceProps = {
      [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: {
        type: baEnum.ObjectType.DEVICE,
        instance: config.deviceId
      },
      [baEnum.PropertyIdentifier.OBJECT_NAME]: config.deviceName,
      [baEnum.PropertyIdentifier.OBJECT_TYPE]: baEnum.ObjectType.DEVICE,
      [baEnum.PropertyIdentifier.SYSTEM_STATUS]: baEnum.DeviceStatus.OPERATIONAL,
      [baEnum.PropertyIdentifier.VENDOR_NAME]: 'BACnet Test Vendor',
      [baEnum.PropertyIdentifier.VENDOR_IDENTIFIER]: config.vendorId,
      [baEnum.PropertyIdentifier.MODEL_NAME]: config.modelName,
      [baEnum.PropertyIdentifier.FIRMWARE_REVISION]: '1.0',
      [baEnum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION]: '1.0',
      [baEnum.PropertyIdentifier.PROTOCOL_VERSION]: 1,
      [baEnum.PropertyIdentifier.PROTOCOL_REVISION]: 19, // BACnet/IP
      [baEnum.PropertyIdentifier.DESCRIPTION]: 'BACnet Device Simulator for Testing',
      [baEnum.PropertyIdentifier.SEGMENTATION_SUPPORTED]: baEnum.Segmentation.SEGMENTED_BOTH,
      [baEnum.PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED]: 1476,
      [baEnum.PropertyIdentifier.LOCAL_TIME]: new Date(),
      [baEnum.PropertyIdentifier.LOCAL_DATE]: new Date(),
      // Aggiungiamo le proprietà mancanti che causano errori
      [baEnum.PropertyIdentifier.PRESENT_VALUE]: 0,
      [baEnum.PropertyIdentifier.STATUS_FLAGS]: {bits: [0, 0, 0, 0]},
      [baEnum.PropertyIdentifier.EVENT_STATE]: baEnum.EventState.NORMAL,
      [baEnum.PropertyIdentifier.RELIABILITY]: baEnum.Reliability.NO_FAULT_DETECTED,
      [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: false,
      [baEnum.PropertyIdentifier.UNITS]: baEnum.EngineeringUnits.NO_UNITS,
      [baEnum.PropertyIdentifier.PRIORITY_ARRAY]: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      [baEnum.PropertyIdentifier.RELINQUISH_DEFAULT]: 0,
      [baEnum.PropertyIdentifier.OBJECT_LIST]: [{type: baEnum.ObjectType.DEVICE, instance: config.deviceId}],
      [baEnum.PropertyIdentifier.MAX_SEGMENTS_ACCEPTED]: baEnum.MaxSegmentsAccepted.SEGMENTS_65,
      [baEnum.PropertyIdentifier.DATABASE_REVISION]: 1,
      [baEnum.PropertyIdentifier.ACTIVE_COV_SUBSCRIPTIONS]: [],
      [baEnum.PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED]: {bits: [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
      [baEnum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED]: {bits: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]},
      [baEnum.PropertyIdentifier.DEVICE_ADDRESS_BINDING]: [],
      [baEnum.PropertyIdentifier.UTC_OFFSET]: 0,
      [baEnum.PropertyIdentifier.DAYLIGHT_SAVINGS_STATUS]: false,
      [baEnum.PropertyIdentifier.LOCATION]: 'Test Location',
      [baEnum.PropertyIdentifier.TIME_SYNCHRONIZATION_RECIPIENTS]: [],
      [baEnum.PropertyIdentifier.UTC_TIME_SYNCHRONIZATION_RECIPIENTS]: [],
      [baEnum.PropertyIdentifier.BACKUP_FAILURE_TIMEOUT]: 60,
      [baEnum.PropertyIdentifier.BACKUP_AND_RESTORE_STATE]: baEnum.BackupState.IDLE
    };

    // Set up event handlers
    this.setupEventHandlers();

    console.log(`Simulator listening on interface ${config.interface}:${config.port}`);
    console.log(`Device ID: ${config.deviceId}`);

    this.client.on('message', (msg: Buffer, rinfo: { address: string; port: number; family: string; size: number }) => {
      console.log(`RAW MESSAGE: Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
    });
  }

  /**
   * Start the BACnet simulator
   */
  public start(): void {
    console.log(`Starting BACnet device simulator with ID: ${SIMULATOR_CONFIG.deviceId}`);
    console.log(`Listening on port ${SIMULATOR_CONFIG.port}`);
    console.log('Configured points:');
    Object.keys(this.data).forEach((key) => {
      const point = this.data[key as keyof typeof SIMULATOR_CONFIG.points];
      console.log(`- ${key}: ${point.type}.${point.instance} (${point.properties[baEnum.PropertyIdentifier.OBJECT_NAME]})`);
    });
  }

  /**
   * Stop the BACnet simulator
   */
  public stop(): void {
    this.client.close();
    console.log('BACnet device simulator stopped');
  }

  /**
   * Set up BACnet event handlers
   */
  private setupEventHandlers(): void {
    // Handle Who-Is requests
    this.client.on('whoIs', (data) => {
      console.log('Received Who-Is request:', data);
      console.log(`Request details: ${JSON.stringify(data)}`);

      // Check if the request is for our device
      const shouldRespond = !data.lowLimit && !data.highLimit ||
                           (data.lowLimit <= SIMULATOR_CONFIG.deviceId &&
                            data.highLimit >= SIMULATOR_CONFIG.deviceId);

      if (shouldRespond) {
        // Respond with I-Am
        this.client.iAmResponse(
            SIMULATOR_CONFIG.deviceId,
            baEnum.Segmentation.SEGMENTED_BOTH,
            SIMULATOR_CONFIG.vendorId
        );
        console.log(`Responded to Who-Is with I-Am for device ${SIMULATOR_CONFIG.deviceId}`);
      }
    });

    // Handle Read-Property requests
    this.client.on('readProperty', (data) => {
      console.log(`Received Read-Property request for ${data.request.objectId.type}.${data.request.objectId.instance}, property ${data.request.property.id}`);

      try {
        const response = this.handleReadProperty(data.request.objectId, data.request.property.id, data.request.property.index);

        this.client.readPropertyResponse(
            data.address,
            data.invokeId,
            data.request.objectId,
            data.request.property,
            response
        );

        console.log(`Responded to Read-Property for ${data.request.objectId.type}.${data.request.objectId.instance}, property ${data.request.property.id}`);
      } catch (error) {
        console.error('Error processing Read-Property request:', error);

        // Respond with error
        this.client.errorResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.READ_PROPERTY,
            data.invokeId,
            baEnum.ErrorClass.OBJECT,
            baEnum.ErrorCode.UNKNOWN_PROPERTY
        );
      }
    });

    // Handle Read-Property-Multiple requests
    this.client.on('readPropertyMultiple', (data) => {
      console.log('Received Read-Property-Multiple request:', data.request);
      try {
        // data.request potrebbe essere un oggetto o un array
        const requestItems = Array.isArray(data.request) ? data.request : [data.request];
        const values: Array<{
            objectId: { type: number; instance: number };
            values: Array<{
            property: { id: number; index?: number };
            value: Array<{ value: any; type: string | number }>;
            }>;
        }> = requestItems.map((item: {
            objectId: { type: number; instance: number };
            properties: Array<{ id: number; index?: number }>
        }) => {
          const objectValues = {
            objectId: item.objectId,
            values: item.properties.map((prop: { id: number; index?: number }) => {
              try {
                const value = this.handleReadProperty(item.objectId, prop.id, prop.index);
                return {
                  property: prop,
                  value: value
                };
              } catch (error) {
                return {
                  property: prop,
                  value: [{value: {errorClass: baEnum.ErrorClass.PROPERTY, errorCode: baEnum.ErrorCode.UNKNOWN_PROPERTY}, type: 'BacnetError'}]
                };
              }
            })
          };
          return objectValues;
        });

        this.client.readPropertyMultipleResponse(
            data.address,
            data.invokeId,
            values
        );

        console.log('Responded to Read-Property-Multiple request');
      } catch (error) {
        console.error('Error processing Read-Property-Multiple request:', error);

        // Respond with error
        this.client.errorResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
            data.invokeId,
            baEnum.ErrorClass.OBJECT,
            baEnum.ErrorCode.UNKNOWN_PROPERTY
        );
      }
    });

    // Handle Write-Property requests
    this.client.on('writeProperty', (data) => {
      console.log(`Received Write-Property request for ${data.request.objectId.type}.${data.request.objectId.instance}, property ${data.request.property.id}`);

      try {
        this.handleWriteProperty(data.request.objectId, data.request.property.id, data.request.property.index, data.request.values);

        // Send simple ACK
        this.client.simpleAckResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.WRITE_PROPERTY,
            data.invokeId
        );

        console.log(`Processed Write-Property for ${data.request.objectId.type}.${data.request.objectId.instance}, property ${data.request.property.id}`);

        // Check for COV subscriptions that need notification
        this.checkAndSendCovNotifications(data.request.objectId, data.request.property.id);
      } catch (error) {
        console.error('Error processing Write-Property request:', error);

        // Respond with error
        this.client.errorResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.WRITE_PROPERTY,
            data.invokeId,
            baEnum.ErrorClass.PROPERTY,
            baEnum.ErrorCode.WRITE_ACCESS_DENIED
        );
      }
    });

    // Handle Subscribe-COV requests
    this.client.on('subscribeCOV', (data) => {
      console.log(`Received Subscribe-COV request for ${data.request.monitoredObjectId.type}.${data.request.monitoredObjectId.instance}`);

      try {
        const subscription = {
          address: data.address,
          subscriptionProcessId: data.request.subscriptionProcessId,
          monitoredObjectId: data.request.monitoredObjectId,
          issueConfirmedNotifications: data.request.issueConfirmedNotifications,
          lifetime: data.request.lifetime || 0,
          timestamp: new Date()
        };

        // Check if this is a cancellation
        if (data.request.cancellationRequest) {
          // Remove subscription
          this.subscriptions = this.subscriptions.filter((s) =>
            !(s.address === data.address &&
              s.subscriptionProcessId === data.request.subscriptionProcessId &&
              s.monitoredObjectId.type === data.request.monitoredObjectId.type &&
              s.monitoredObjectId.instance === data.request.monitoredObjectId.instance)
          );
          console.log('Removed COV subscription');
        } else {
          // Add or update subscription
          const existingIndex = this.subscriptions.findIndex((s) =>
            s.address === data.address &&
            s.subscriptionProcessId === data.request.subscriptionProcessId &&
            s.monitoredObjectId.type === data.request.monitoredObjectId.type &&
            s.monitoredObjectId.instance === data.request.monitoredObjectId.instance
          );

          if (existingIndex >= 0) {
            this.subscriptions[existingIndex] = subscription;
            console.log('Updated existing COV subscription');
          } else {
            this.subscriptions.push(subscription);
            console.log('Added new COV subscription');
          }
        }

        // Send simple ACK
        this.client.simpleAckResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV,
            data.invokeId
        );

        // Send initial notification
        if (!data.request.cancellationRequest) {
          this.sendCovNotification(subscription);
        }
      } catch (error) {
        console.error('Error processing Subscribe-COV request:', error);

        // Respond with error
        this.client.errorResponse(
            data.address,
            baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV,
            data.invokeId,
            baEnum.ErrorClass.OBJECT,
            baEnum.ErrorCode.NO_OBJECTS_OF_SPECIFIED_TYPE
        );
      }
    });
  }

  /**
   * Handle reading a property value
   */
  private handleReadProperty(objectId: { type: number, instance: number }, propertyId: number, propertyIndex?: number): any[] {
    // Handle device object
    if (objectId.type === baEnum.ObjectType.DEVICE && objectId.instance === SIMULATOR_CONFIG.deviceId) {
      const value = this.deviceProps[propertyId];
      if (value === undefined) {
        throw new Error(`Unknown property ${propertyId} for device object`);
      }

      if (propertyId === baEnum.PropertyIdentifier.LOCAL_TIME ||
          propertyId === baEnum.PropertyIdentifier.LOCAL_DATE) {
        // Return current time/date
        return [{value: new Date(), type: baEnum.ApplicationTags.DATETIME}];
      }

      const type = this.getApplicationTagForValue(value);
      return [{value, type}];
    }

    // Handle other object types
    const objectKey = this.findObjectKey(objectId);
    if (!objectKey) {
      throw new Error(`Unknown object ${objectId.type}.${objectId.instance}`);
    }

    const object = this.data[objectKey as keyof typeof SIMULATOR_CONFIG.points];
    const value = object.properties[propertyId];

    if (value === undefined) {
      throw new Error(`Unknown property ${propertyId} for object ${objectId.type}.${objectId.instance}`);
    }

    const type = this.getApplicationTagForValue(value);
    return [{value, type}];
  }

  /**
   * Handle writing a property value
   */
  private handleWriteProperty(objectId: { type: number, instance: number }, propertyId: number, propertyIndex: number, values: any[]): void {
    // Find the object
    const objectKey = this.findObjectKey(objectId);
    if (!objectKey) {
      throw new Error(`Unknown object ${objectId.type}.${objectId.instance}`);
    }

    // Only allow writing to PRESENT_VALUE
    if (propertyId !== baEnum.PropertyIdentifier.PRESENT_VALUE) {
      throw new Error(`Writing to property ${propertyId} not supported`);
    }

    // Update the value
    const newValue = values[0].value;
    const oldValue = this.data[objectKey as keyof typeof SIMULATOR_CONFIG.points].properties[propertyId];

    (this.data[objectKey as keyof typeof SIMULATOR_CONFIG.points].properties as Record<number, any>)[propertyId] = newValue;

    console.log(`Updated ${objectId.type}.${objectId.instance} property ${propertyId} from ${oldValue} to ${newValue}`);
  }

  /**
   * Find the key for an object in the data store
   */
  private findObjectKey(objectId: { type: number, instance: number }): string | null {
    for (const key in this.data) {
      if (Object.prototype.hasOwnProperty.call(this.data, key)) {
        const obj = this.data[key as keyof typeof SIMULATOR_CONFIG.points];
        if (obj.type === objectId.type && obj.instance === objectId.instance) {
          return key;
        }
      }
    }
    return null;
  }

  /**
   * Determine the appropriate BACnet application tag for a value
   */
  private getApplicationTagForValue(value: any): number {
    if (value === null) return baEnum.ApplicationTags.NULL;

    const type = typeof value;

    switch (type) {
      case 'boolean':
        return baEnum.ApplicationTags.BOOLEAN;
      case 'number':
        // Determine if it's a float or int
        return Number.isInteger(value) ?
          baEnum.ApplicationTags.UNSIGNED_INTEGER :
          baEnum.ApplicationTags.REAL;
      case 'string':
        return baEnum.ApplicationTags.CHARACTER_STRING;
      case 'object':
        if (value instanceof Date) {
          return baEnum.ApplicationTags.DATETIME;
        }
        if (value.type !== undefined && value.instance !== undefined) {
          return baEnum.ApplicationTags.OBJECTIDENTIFIER;
        }
        if (value.bits !== undefined) {
          return baEnum.ApplicationTags.BIT_STRING;
        }
        return baEnum.ApplicationTags.OCTET_STRING;
      default:
        return baEnum.ApplicationTags.CHARACTER_STRING;
    }
  }

  /**
   * Check for and send COV notifications after a value change
   */
  private checkAndSendCovNotifications(objectId: { type: number, instance: number }, propertyId: number): void {
    // Only send notifications for PRESENT_VALUE changes
    if (propertyId !== baEnum.PropertyIdentifier.PRESENT_VALUE) {
      return;
    }

    // Find subscriptions for this object
    const matchingSubscriptions = this.subscriptions.filter((s) =>
      s.monitoredObjectId.type === objectId.type &&
      s.monitoredObjectId.instance === objectId.instance
    );

    // Send notifications
    matchingSubscriptions.forEach((sub) => {
      this.sendCovNotification(sub);
    });
  }

  /**
   * Send a COV notification to a subscriber
   */
  private sendCovNotification(subscription: any): void {
    const objectKey = this.findObjectKey(subscription.monitoredObjectId);
    if (!objectKey) {
      console.error(`Cannot send COV notification - object ${subscription.monitoredObjectId.type}.${subscription.monitoredObjectId.instance} not found`);
      return;
    }

    const object = this.data[objectKey as keyof typeof SIMULATOR_CONFIG.points];

    // Create notification data
    const covNotification = {
      subscriberProcessId: subscription.subscriptionProcessId,
      initiatingDeviceId: {
        type: baEnum.ObjectType.DEVICE,
        instance: SIMULATOR_CONFIG.deviceId
      },
      monitoredObjectId: subscription.monitoredObjectId,
      timeRemaining: subscription.lifetime,
      listOfValues: [
        {
          propertyId: baEnum.PropertyIdentifier.PRESENT_VALUE,
          value: [{type: this.getApplicationTagForValue(object.properties[baEnum.PropertyIdentifier.PRESENT_VALUE]), value: object.properties[baEnum.PropertyIdentifier.PRESENT_VALUE]}]
        },
        {
          propertyId: baEnum.PropertyIdentifier.STATUS_FLAGS,
          value: [{type: baEnum.ApplicationTags.BIT_STRING, value: object.properties[baEnum.PropertyIdentifier.STATUS_FLAGS]}]
        }
      ]
    };

    // Send notification
    if (subscription.issueConfirmedNotifications) {
      this.client.confirmedEventNotification(
          subscription.address,
          covNotification,
          {},
          (err) => {
            if (err) {
              console.error('Error sending confirmed COV notification:', err);
            } else {
              console.log(`Sent confirmed COV notification to ${subscription.address} for ${subscription.monitoredObjectId.type}.${subscription.monitoredObjectId.instance}`);
            }
          }
      );
    } else {
      this.client.unconfirmedEventNotification(
          subscription.address,
          covNotification
      );
      console.log(`Sent unconfirmed COV notification to ${subscription.address} for ${subscription.monitoredObjectId.type}.${subscription.monitoredObjectId.instance}`);
    }
  }
}

// Create and start the simulator
const simulator = new BacnetDeviceSimulator(SIMULATOR_CONFIG);
simulator.start();

// Handle program termination
process.on('SIGINT', () => {
  console.log('Shutting down BACnet device simulator...');
  simulator.stop();
  process.exit(0);
});

export default simulator;
