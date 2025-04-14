'use strict';

import {describe, expect, it} from '@jest/globals';

import {Client} from '../../src/lib/client';
import * as baEnum from '../../src/lib/enum';

describe('bacstack - whoIs compliance', () => {
  let client: Client;
  let externalClient: Client;

  beforeEach(() => {
    client = new Client();
    externalClient = new Client();
  });

  afterEach(() => {
    client.close();
    externalClient.close();
  });

  it('should find the device simulator', (next) => {
    client.on('iAm', (device) => {
      expect(device.deviceId).toEqual(1234);
      expect(device.maxApdu).toEqual(1482);
      expect(device.segmentation).toEqual(baEnum.Segmentation.NO_SEGMENTATION);
      expect(device.vendorId).toEqual(260);
      next();
    });

    externalClient.on('whoIs', () => {
      externalClient.iAmResponse(1234, baEnum.Segmentation.NO_SEGMENTATION, 260);
    });

    client.whoIs();
  });

  it('should find the device simulator with provided min device ID', (next) => {
    client.on('iAm', (device) => {
      expect(device.deviceId).toEqual(1234);
      next();
    });

    externalClient.on('whoIs', () => {
      externalClient.iAmResponse(1234, baEnum.Segmentation.NO_SEGMENTATION, 260);
    });

    client.whoIs({lowLimit: 1233});
  });

  it('should find the device simulator with provided min/max device ID and IP', (next) => {
    client.on('iAm', (device) => {
      expect(device.deviceId).toEqual(1234);
      next();
    });

    externalClient.on('whoIs', () => {
      externalClient.iAmResponse(1234, baEnum.Segmentation.NO_SEGMENTATION, 260);
    });

    client.whoIs({lowLimit: 1233, highLimit: 1235});
  });
});
