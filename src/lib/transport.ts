'use strict';

import {createSocket, Socket} from 'dgram';
import {EventEmitter} from 'events';

import {TransportSettings} from './types';

export class Transport extends EventEmitter {
  private _settings: TransportSettings;
  private _server: Socket;

  constructor(settings: TransportSettings) {
    super();
    this._settings = settings;
    this._server = createSocket({type: 'udp4', reuseAddr: true});
    this._server.on('message', (msg, rinfo) => this.emit('message', msg, rinfo.address));
    this._server.on('error', (err) => this.emit('message', err));
  }

  getBroadcastAddress(): string | undefined {
    return this._settings.broadcastAddress;
  }

  getMaxPayload(): number {
    return 1482;
  }

  send(buffer: Buffer, offset: number, receiver: string): void {
    this._server.send(buffer, 0, offset, this._settings.port || 47808, receiver);
  }

  open(): void {
    this._server.bind(this._settings.port || 47808, this._settings.interface, () => {
      this._server.setBroadcast(true);
    });
  }

  close(): void {
    this._server.close();
  }
}
