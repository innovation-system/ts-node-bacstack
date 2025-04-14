export interface EncodeBuffer {
  buffer: Buffer;
  offset: number;
}

export interface BACNetAddress {
  type?: number;
  net?: number;
  adr?: number[];
}

export interface TransportSettings {
  port?: number;
  interface?: string;
  broadcastAddress?: string;
}

export interface BACNetObjectID {
  type: number;
  instance: number;
}

export interface BACNetPropertyID {
  id: number;
  index: number;
}

export interface BACNetReadAccessSpecification {
  objectId: BACNetObjectID;
  properties: BACNetPropertyID[];
}

export interface BACNetBitString {
  bitsUsed: number;
  value: number[];
}

export interface BACNetCovSubscription {
  recipient: {
    network: number;
    address: number[];
  };
  subscriptionProcessId: number;
  monitoredObjectId: BACNetObjectID;
  monitoredProperty: BACNetPropertyID;
  issueConfirmedNotifications: boolean;
  timeRemaining: number;
  covIncrement: number;
}

export interface BACNetAlarm {
  objectId: BACNetObjectID;
  alarmState: number;
  acknowledgedTransitions: BACNetBitString;
}

export interface BACNetEvent {
  objectId: BACNetObjectID;
  eventState: number;
  acknowledgedTransitions: BACNetBitString;
  eventTimeStamps: Date[];
  notifyType: number;
  eventEnable: BACNetBitString;
  eventPriorities: number[];
}

export interface BACNetDevObjRef {
  id: number;
  arrayIndex: number;
  objectId: BACNetObjectID;
  deviceIndentifier: BACNetObjectID;
}

export interface BACNetAppData {
  type: number;
  value: any;
  encoding?: number;
}

export interface BACNetPropertyState {
  type: number;
  state: number;
}

export interface BACNetEventInformation {
  objectId: BACNetObjectID;
  eventState: number;
  acknowledgedTransitions: BACNetBitString;
  eventTimeStamps: any[];
  notifyType: number;
  eventEnable: BACNetBitString;
  eventPriorities: number[];
}

export interface Decode<T> {
  len: number;
  value: T;
}

export interface Tag {
  len: number;
  tagNumber: number;
  value?: number;
}

export interface ObjectId {
  len: number;
  objectType: number;
  instance: number;
}

export interface ApplicationData {
  len: number;
  type: number;
  value: any;
  encoding?: number;
}

export interface BACNetReadAccess {
  objectId: BACNetObjectID;
  values: {
    property: BACNetPropertyID;
    value: any[];
  }[];
}

export interface ReadAccessDecode {
  len: number;
  value: {
    objectId: BACNetObjectID;
    values: any[];
  };
}

export interface CharacterString extends Decode<string> {
  encoding: number;
}

export interface CalendarDate {
  len: number;
  year: number;
  month: number;
  day: number;
  wday: number;
}

export interface CalendarDateRange {
  len: number;
  startDate: Decode<Date>;
  endDate: Decode<Date>;
}

export interface CalendarWeekDay {
  len: number;
  month: number;
  week: number;
  wday: number;
}

export interface Calendar {
  len: number;
  value: any[];
}

export interface AppData {
  len: number;
  type: number;
  value: any;
  encoding?: number;
}

export interface DeviceObjPropertyRef {
  len: number;
  value: {
    objectId: ObjectId;
    id: Decode<number>;
  };
}

export interface ReadAccessSpec {
  len: number;
  value: BACNetReadAccessSpecification;
}

export interface CovSubscription {
  len: number;
  value: BACNetCovSubscription;
}

export interface ContextTagWithLength {
  len: number;
  value: boolean;
}

export interface ContextCharacterString extends Decode<string> {
  encoding: number;
}

export interface BasePacket {
  len: number;
  type: number;
}

export interface ConfirmedServiceRequest extends BasePacket {
  service: number;
  maxSegments: number;
  maxApdu: number;
  invokeId: number;
  sequencenumber: number;
  proposedWindowNumber: number;
}

export interface UnconfirmedServiceRequest extends BasePacket {
  service: number;
}

export interface SimpleAck extends BasePacket {
  service: number;
  invokeId: number;
}

export interface ComplexAck extends BasePacket {
  service: number;
  invokeId: number;
  sequencenumber: number;
  proposedWindowNumber: number;
}

export interface SegmentAck extends BasePacket {
  originalInvokeId: number;
  sequencenumber: number;
  actualWindowSize: number;
}

export interface Error extends BasePacket {
  service: number;
  invokeId: number;
}

export interface Abort extends BasePacket {
  invokeId: number;
  reason: number;
}
