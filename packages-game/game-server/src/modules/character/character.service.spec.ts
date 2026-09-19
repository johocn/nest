import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CharacterService } from './character.service';
import {
  Character,
  CharacterAttribute,
  CharacterStatus,
  CharacterFaction,
  CharacterLocation,
  CharacterProfile,
  CharacterQualification,
  CharacterSpecialty,
  CharacterCombatStyle,
  CharacterResource,
  CharacterConsumption,
  CharacterMemory,
  CharacterEspionage,
  CharacterCompanion,
  CharacterSpecialEffect,
  CharacterDarkened,
  CharacterNeeds,
  CharacterMartialArt,
  CharacterRelationship,
  TitleTemplate,
  CharacterTitle,
} from './entities';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  Profession,
  Gender,
  Faction,
  CombatStyle,
  MartialArtType,
} from '@constants/enums';

describe('CharacterService', () => {
  let service: CharacterService;

  // Create a mock repository factory
  function mockRepo() {
    return {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: data.id || '1' })),
      findOne: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
    };
  }

  const repos = {
    character: mockRepo(),
    attribute: mockRepo(),
    status: mockRepo(),
    faction: mockRepo(),
    location: mockRepo(),
    profile: mockRepo(),
    qualification: mockRepo(),
    specialty: mockRepo(),
    combatStyle: mockRepo(),
    resource: mockRepo(),
    consumption: mockRepo(),
    memory: mockRepo(),
    espionage: mockRepo(),
    companion: mockRepo(),
    specialEffect: mockRepo(),
    darkened: mockRepo(),
    needs: mockRepo(),
    martialArt: mockRepo(),
    relationship: mockRepo(),
    title: mockRepo(),
    charTitle: mockRepo(),
  };

  const entityTokenMap = {
    [getRepositoryToken(Character)]: repos.character,
    [getRepositoryToken(CharacterAttribute)]: repos.attribute,
    [getRepositoryToken(CharacterStatus)]: repos.status,
    [getRepositoryToken(CharacterFaction)]: repos.faction,
    [getRepositoryToken(CharacterLocation)]: repos.location,
    [getRepositoryToken(CharacterProfile)]: repos.profile,
    [getRepositoryToken(CharacterQualification)]: repos.qualification,
    [getRepositoryToken(CharacterSpecialty)]: repos.specialty,
    [getRepositoryToken(CharacterCombatStyle)]: repos.combatStyle,
    [getRepositoryToken(CharacterResource)]: repos.resource,
    [getRepositoryToken(CharacterConsumption)]: repos.consumption,
    [getRepositoryToken(CharacterMemory)]: repos.memory,
    [getRepositoryToken(CharacterEspionage)]: repos.espionage,
    [getRepositoryToken(CharacterCompanion)]: repos.companion,
    [getRepositoryToken(CharacterSpecialEffect)]: repos.specialEffect,
    [getRepositoryToken(CharacterDarkened)]: repos.darkened,
    [getRepositoryToken(CharacterNeeds)]: repos.needs,
    [getRepositoryToken(CharacterMartialArt)]: repos.martialArt,
    [getRepositoryToken(CharacterRelationship)]: repos.relationship,
    [getRepositoryToken(TitleTemplate)]: repos.title,
    [getRepositoryToken(CharacterTitle)]: repos.charTitle,
  };

  beforeEach(async () => {
    Object.values(repos).forEach((r) => {
      r.create.mockClear();
      r.save.mockClear();
      r.findOne.mockClear();
      r.find.mockClear();
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        CharacterService,
        ...Object.entries(entityTokenMap).map(([token, repo]) => ({
          provide: token,
          useValue: repo,
        })),
      ],
    }).compile();
    service = moduleRef.get<CharacterService>(CharacterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a character with all sub-tables', async () => {
    repos.character.findOne.mockResolvedValue(null); // no existing char for player
    repos.character.save.mockResolvedValue({
      id: '1',
      name: 'TestHero',
      playerId: 'p1',
    });

    const result = await service.createCharacter({
      playerId: 'p1',
      name: 'TestHero',
      nickname: '江湖小虾',
      profession: Profession.SCHOLAR,
      gender: Gender.MALE,
      age: 25,
    });

    expect(result.id).toBe('1');
    expect(result.name).toBe('TestHero');
    // Main character saved once
    expect(repos.character.save).toHaveBeenCalledTimes(1);
    // 15 one-to-one sub-tables each saved once
    expect(repos.attribute.save).toHaveBeenCalledTimes(1);
    expect(repos.status.save).toHaveBeenCalledTimes(1);
    expect(repos.faction.save).toHaveBeenCalledTimes(1);
    expect(repos.location.save).toHaveBeenCalledTimes(1);
    expect(repos.profile.save).toHaveBeenCalledTimes(1);
    expect(repos.qualification.save).toHaveBeenCalledTimes(1);
    expect(repos.specialty.save).toHaveBeenCalledTimes(1);
    expect(repos.combatStyle.save).toHaveBeenCalledTimes(1);
    expect(repos.resource.save).toHaveBeenCalledTimes(1);
    expect(repos.consumption.save).toHaveBeenCalledTimes(1);
    expect(repos.memory.save).toHaveBeenCalledTimes(1);
    expect(repos.espionage.save).toHaveBeenCalledTimes(1);
    expect(repos.companion.save).toHaveBeenCalledTimes(1);
    expect(repos.darkened.save).toHaveBeenCalledTimes(1);
    expect(repos.needs.save).toHaveBeenCalledTimes(1);
    // 4 martial arts (fist/palm/leg/weapon)
    expect(repos.martialArt.save).toHaveBeenCalledTimes(4);
  });

  it('should throw if player already has a character', async () => {
    repos.character.findOne.mockResolvedValue({ id: '99', playerId: 'p1' });

    await expect(
      service.createCharacter({
        playerId: 'p1',
        name: 'Dup',
        nickname: 'dup',
        profession: Profession.FARMER,
        gender: Gender.FEMALE,
        age: 20,
      }),
    ).rejects.toThrow(GameException);
  });

  it('should get full character profile with all sub-tables', async () => {
    repos.character.findOne.mockResolvedValue({
      id: '1',
      name: 'Hero',
      playerId: 'p1',
    });
    repos.attribute.findOne.mockResolvedValue({ strength: 50 });
    repos.status.findOne.mockResolvedValue({ health: 100 });
    repos.faction.findOne.mockResolvedValue({ faction: Faction.NEUTRAL });
    repos.location.findOne.mockResolvedValue({ posX: 100, posY: 200 });
    repos.profile.findOne.mockResolvedValue({ avatar: { url: 'test' } });
    repos.qualification.findOne.mockResolvedValue({ qualification: 3 });
    repos.specialty.findOne.mockResolvedValue({ primarySpecialty: 'scholar' });
    repos.combatStyle.findOne.mockResolvedValue({
      style: CombatStyle.BALANCED,
    });
    repos.resource.findOne.mockResolvedValue({ food: 100 });
    repos.consumption.findOne.mockResolvedValue({ status: 'normal' });
    repos.memory.findOne.mockResolvedValue({ friends: [] });
    repos.espionage.findOne.mockResolvedValue({ canSpy: false });
    repos.companion.findOne.mockResolvedValue({ companionType: 'none' });
    repos.darkened.findOne.mockResolvedValue({ isDarkened: false });
    repos.needs.findOne.mockResolvedValue({ survival: 50 });
    repos.martialArt.find.mockResolvedValue([
      { artType: MartialArtType.FIST, level: 10 },
      { artType: MartialArtType.WEAPON, level: 5 },
    ]);
    repos.relationship.find.mockResolvedValue([]);

    const result = await service.getFullProfile('1');

    expect(result.character.name).toBe('Hero');
    expect(result.attribute.strength).toBe(50);
    expect(result.status.health).toBe(100);
    expect(result.martialArts).toHaveLength(2);
    expect(result.relationships).toHaveLength(0);
  });

  it('should throw if character not found in getFullProfile', async () => {
    repos.character.findOne.mockResolvedValue(null);
    await expect(service.getFullProfile('999')).rejects.toThrow(GameException);
  });

  it('should get character by player id', async () => {
    const mockChar = { id: '1', playerId: 'p1', name: 'Hero' };
    repos.character.findOne.mockResolvedValue(mockChar);

    const result = await service.getByPlayerId('p1');
    expect(result).toEqual(mockChar);
  });

  it('should update attribute', async () => {
    const mockAttr = { characterId: '1', strength: 10 };
    repos.attribute.findOne.mockResolvedValue(mockAttr);
    repos.attribute.save.mockResolvedValue({ ...mockAttr, strength: 50 });

    const result = await service.updateAttribute('1', { strength: 50 });
    expect(result.strength).toBe(50);
  });

  it('should update location', async () => {
    const mockLoc = { characterId: '1', posX: 0, posY: 0 };
    repos.location.findOne.mockResolvedValue(mockLoc);
    repos.location.save.mockResolvedValue({ ...mockLoc, posX: 100, posY: 200 });

    const result = await service.updateLocation('1', { posX: 100, posY: 200 });
    expect(result.posX).toBe(100);
  });

  it('should add martial art', async () => {
    repos.martialArt.findOne.mockResolvedValue(null);
    repos.martialArt.save.mockImplementation(async (data) => ({
      ...data,
      id: '1',
    }));

    const result = await service.upsertMartialArt('1', MartialArtType.FIST, 10);
    expect(result.artType).toBe(MartialArtType.FIST);
    expect(result.level).toBe(10);
  });

  it('should update existing martial art', async () => {
    const existing = {
      id: '1',
      characterId: '1',
      artType: MartialArtType.PALM,
      level: 5,
    };
    repos.martialArt.findOne.mockResolvedValue(existing);
    repos.martialArt.save.mockResolvedValue({ ...existing, level: 20 });

    const result = await service.upsertMartialArt('1', MartialArtType.PALM, 20);
    expect(result.level).toBe(20);
  });

  describe('角色名片与称号', () => {
    it('updateCard 校验长度并保存', async () => {
      repos.profile.findOne.mockResolvedValue({
        characterId: '1',
        alias: null,
        poem: null,
      });
      repos.profile.save.mockImplementation((v) => Promise.resolve(v));

      await expect(
        service.updateCard('1', { alias: 'x'.repeat(25) }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.PARAM_INVALID } });

      const result = await service.updateCard('1', {
        alias: '逍遥客',
        poem: '十步杀一人，千里不留行',
      });
      expect(result.alias).toBe('逍遥客');
    });

    it('equipTitle 未拥有拒绝', async () => {
      repos.charTitle.findOne.mockResolvedValue(null);
      await expect(
        service.equipTitle('1', '10', true),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.TITLE_NOT_OWNED } });
    });

    it('grantTitle 幂等：已拥有不重复插入', async () => {
      repos.title.findOne.mockResolvedValue({
        id: '10',
        name: '状元',
        iconUrl: null,
      });
      repos.charTitle.findOne.mockResolvedValue(null);
      repos.charTitle.save.mockImplementation((v) => Promise.resolve(v));

      await expect(service.grantTitle('1', '10')).resolves.toBeDefined();

      repos.charTitle.findOne.mockResolvedValue({
        characterId: '1',
        titleId: '10',
      });
      await expect(service.grantTitle('1', '10')).resolves.toBeDefined();

      expect(repos.charTitle.save).toHaveBeenCalledTimes(1);
    });

    it('getCard 返回脱敏名片', async () => {
      repos.profile.findOne.mockResolvedValue({
        characterId: '1',
        alias: '逍遥客',
        poem: '十步杀一人',
      });
      repos.character.findOne.mockResolvedValue({ id: '1', name: '张三' });
      repos.charTitle.find.mockResolvedValue([
        { characterId: '1', titleId: '10', isEquipped: true },
      ]);
      repos.title.find.mockResolvedValue([
        { id: '10', name: '状元', iconUrl: 'icon.png' },
      ]);

      const result = await service.getCard('1');
      expect(result).toEqual({
        name: '张三',
        alias: '逍遥客',
        poem: '十步杀一人',
        titles: [{ name: '状元', iconUrl: 'icon.png' }],
      });
    });
  });
});
