import { Test } from '@nestjs/testing';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let service: LoggerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LoggerService],
    }).compile();
    service = moduleRef.get<LoggerService>(LoggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call log without throwing', () => {
    expect(() => service.log('test message')).not.toThrow();
  });

  it('should call error without throwing', () => {
    expect(() => service.error('error message')).not.toThrow();
  });

  it('should call warn without throwing', () => {
    expect(() => service.warn('warn message')).not.toThrow();
  });
});
