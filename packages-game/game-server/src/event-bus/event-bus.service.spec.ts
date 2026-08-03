import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from './event-bus.service';
import { GameEvents } from './game-events';

describe('EventBusService', () => {
  let service: EventBusService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventBusService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();
    service = moduleRef.get<EventBusService>(EventBusService);
    eventEmitter = moduleRef.get<EventEmitter2>(EventEmitter2);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should emit an event', () => {
    const payload = { characterId: 1, monsterTemplateId: 100 };
    service.emit(GameEvents.MONSTER_KILLED, payload);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      GameEvents.MONSTER_KILLED,
      payload,
    );
  });

  it('should emit async and return results', async () => {
    const payload = { playerId: 1, newLevel: 10 };
    const results = await service.emitAsync(GameEvents.LEVEL_UP, payload);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      GameEvents.LEVEL_UP,
      payload,
    );
    expect(results).toEqual([]);
  });
});
