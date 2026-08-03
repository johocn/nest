import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class EventBusService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: string, payload: any): void {
    this.eventEmitter.emit(event, payload);
  }

  async emitAsync(event: string, payload: any): Promise<any[]> {
    return this.eventEmitter.emitAsync(event, payload);
  }
}
