'use strict';

import {createSocket, Socket} from 'dgram';
import {EventEmitter} from 'events';

import {TransportSettings} from './types';
import debugLib from 'debug';

const debug = debugLib('bacnet:transport:debug');
const trace = debugLib('bacnet:transport:trace');

const DEFAULT_BACNET_PORT = 47808;


export class Transport extends EventEmitter {
  private _settings: TransportSettings;
  private _server: Socket;
  private _lastSendMessages: Record<string, Buffer> = {};
  private ownAddress: {address: string; port: number} = {address: '', port: 0};

  constructor(settings: TransportSettings) {
    super();
    this._settings = settings;
    this._server = createSocket({type: 'udp4', reuseAddr: false});
    this._server.on('message', (msg, rinfo) => {
      // Check for duplicate messages
      if (this.ownAddress.port === rinfo.port) {
        for (const [messageKey, earlierSentBuffer] of Object.entries(this._lastSendMessages)) {
          if (msg.equals(earlierSentBuffer)) {
            debug(`server IGNORE message from ${rinfo.address}:${rinfo.port} (${messageKey}): ${msg.toString('hex')}`);
            return;
          }
        }
      }
      debug(`server got message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
      this.emit('message', msg, rinfo.address + (rinfo.port === DEFAULT_BACNET_PORT ? '' : ':' + rinfo.port));
    });
    this._server.on('listening', () => {
      this.ownAddress = this._server.address();
      debug(`server listening on ${this.ownAddress.address}:${this.ownAddress.port}`);
      this.emit('listening', this.ownAddress);
    });
    this._server.on('error', (err) => {
      debug('transport error', err.message);
      this.emit('error', err);
    });
    this._server.on('close', () => {
      debug('transport closed');
      this.emit('close');
      // close is to do by the client.close() which calls the transport.close which calls the _server.close
    });
  }

  getBroadcastAddress(): string | undefined {
    return this._settings.broadcastAddress;
  }

  getMaxPayload(): number {
    return 1482;
  }

  send(buffer: Buffer, offset: number, receiver: string): void {
    if (!receiver) {
      receiver = this.getBroadcastAddress();
      const dataToSend = Buffer.alloc(offset);
      // Sort out broadcasted messages that we also receive
      // TODO Find a better way?
      const hrTime = process.hrtime();
      const messageKey = hrTime[0] * 1000000000 + hrTime[1];
      buffer.copy(dataToSend, 0, 0, offset);
      this._lastSendMessages[messageKey] = dataToSend;
      setTimeout(() => {
        delete this._lastSendMessages[messageKey];
      }, 10000); // delete after 10s, hopefully all cases are handled by that
    }
    const [address, port] = receiver.split(':');
    debug('Send packet to ' + receiver + ': ' + buffer.toString('hex').substring(0, offset * 2));
    this._server.send(buffer, 0, offset, parseInt(port) || DEFAULT_BACNET_PORT, address);
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
