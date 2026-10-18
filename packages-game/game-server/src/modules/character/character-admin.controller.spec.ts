import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { CharacterAdminController } from './character-admin.controller';
import { CharacterService } from './character.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('CharacterAdminController', () => {
  let ctrl: CharacterAdminController;
  let characterService: any;

  beforeAll(async () => {
    characterService = {
      getFullProfile: jest.fn(),
      getById: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [CharacterAdminController],
      providers: [
        { provide: CharacterService, useValue: characterService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(CharacterAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', CharacterAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('getProfile 透传 id', async () => {
    const profile = { id: 'c1', name: 'hero', skills: [] };
    characterService.getFullProfile.mockResolvedValue(profile);
    const res = await ctrl.getProfile('c1');
    expect(characterService.getFullProfile).toHaveBeenCalledWith('c1');
    expect(res).toEqual(profile);
  });

  it('getDetail 透传 id', async () => {
    const detail = { id: 'c1', name: 'hero' };
    characterService.getById.mockResolvedValue(detail);
    const res = await ctrl.getDetail('c1');
    expect(characterService.getById).toHaveBeenCalledWith('c1');
    expect(res).toEqual(detail);
  });
});
