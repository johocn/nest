import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
} from './entities';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  Profession,
  Gender,
  Faction,
  CombatStyle,
  Region,
  HungerStatus,
  QualificationType,
  CompanionType,
  MartialArtType,
} from '@constants/enums';

export interface CreateCharacterDto {
  playerId: string;
  name: string;
  nickname: string;
  profession: Profession;
  gender: Gender;
  age: number;
  birthday?: string;
}

export interface FullCharacterProfile {
  character: Character;
  attribute: CharacterAttribute | null;
  status: CharacterStatus | null;
  faction: CharacterFaction | null;
  location: CharacterLocation | null;
  profile: CharacterProfile | null;
  qualification: CharacterQualification | null;
  specialty: CharacterSpecialty | null;
  combatStyle: CharacterCombatStyle | null;
  resource: CharacterResource | null;
  consumption: CharacterConsumption | null;
  memory: CharacterMemory | null;
  espionage: CharacterEspionage | null;
  companion: CharacterCompanion | null;
  darkened: CharacterDarkened | null;
  needs: CharacterNeeds | null;
  martialArts: CharacterMartialArt[];
  relationships: CharacterRelationship[];
}

@Injectable()
export class CharacterService {
  constructor(
    @InjectRepository(Character)
    private readonly charRepo: Repository<Character>,
    @InjectRepository(CharacterAttribute)
    private readonly attrRepo: Repository<CharacterAttribute>,
    @InjectRepository(CharacterStatus)
    private readonly statusRepo: Repository<CharacterStatus>,
    @InjectRepository(CharacterFaction)
    private readonly factionRepo: Repository<CharacterFaction>,
    @InjectRepository(CharacterLocation)
    private readonly locRepo: Repository<CharacterLocation>,
    @InjectRepository(CharacterProfile)
    private readonly profileRepo: Repository<CharacterProfile>,
    @InjectRepository(CharacterQualification)
    private readonly qualRepo: Repository<CharacterQualification>,
    @InjectRepository(CharacterSpecialty)
    private readonly specRepo: Repository<CharacterSpecialty>,
    @InjectRepository(CharacterCombatStyle)
    private readonly combatRepo: Repository<CharacterCombatStyle>,
    @InjectRepository(CharacterResource)
    private readonly resRepo: Repository<CharacterResource>,
    @InjectRepository(CharacterConsumption)
    private readonly consumeRepo: Repository<CharacterConsumption>,
    @InjectRepository(CharacterMemory)
    private readonly memRepo: Repository<CharacterMemory>,
    @InjectRepository(CharacterEspionage)
    private readonly espRepo: Repository<CharacterEspionage>,
    @InjectRepository(CharacterCompanion)
    private readonly compRepo: Repository<CharacterCompanion>,
    @InjectRepository(CharacterSpecialEffect)
    private readonly effectRepo: Repository<CharacterSpecialEffect>,
    @InjectRepository(CharacterDarkened)
    private readonly darkRepo: Repository<CharacterDarkened>,
    @InjectRepository(CharacterNeeds)
    private readonly needsRepo: Repository<CharacterNeeds>,
    @InjectRepository(CharacterMartialArt)
    private readonly maRepo: Repository<CharacterMartialArt>,
    @InjectRepository(CharacterRelationship)
    private readonly relRepo: Repository<CharacterRelationship>,
  ) {}

  async createCharacter(dto: CreateCharacterDto): Promise<Character> {
    // Check if player already has a character
    if (dto.playerId) {
      const existing = await this.charRepo.findOne({
        where: { playerId: dto.playerId },
      });
      if (existing) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '玩家已有角色');
      }
    }

    // Create main character
    const character = this.charRepo.create({
      playerId: dto.playerId,
      name: dto.name,
      nickname: dto.nickname,
      profession: dto.profession,
      gender: dto.gender,
      age: dto.age,
      birthday: dto.birthday ?? null,
      isNpc: !dto.playerId,
    });
    const saved = await this.charRepo.save(character);

    // Initialize all one-to-one sub-tables with defaults
    const cid = saved.id;

    await this.attrRepo.save(
      this.attrRepo.create({
        characterId: cid,
        strength: 10,
        speed: 10,
        defense: 10,
        intelligence: 10,
        comprehension: 10,
        loyalty: 50,
        loyaltyBase: 50,
        combatPower: '0',
      }),
    );
    await this.statusRepo.save(
      this.statusRepo.create({
        characterId: cid,
        health: 100,
        wealth: '0',
        reputation: 50,
        isAlive: true,
        season: 1,
        family: [],
      }),
    );
    await this.factionRepo.save(
      this.factionRepo.create({
        characterId: cid,
        faction: Faction.NEUTRAL,
        factionName: '中立',
        factionLevel: 5,
        factionRelations: { righteous: 0, evil: 0, neutral: 0 },
      }),
    );
    await this.locRepo.save(
      this.locRepo.create({
        characterId: cid,
        mapId: 'map_001',
        region: Region.CENTRAL_CITY,
        posX: 0,
        posY: 0,
        posZ: 0,
        indoors: false,
        pathHistory: [],
      }),
    );
    await this.profileRepo.save(
      this.profileRepo.create({
        characterId: cid,
        avatar: {},
        videos: {},
        bio: {},
        background: {},
      }),
    );
    await this.qualRepo.save(
      this.qualRepo.create({
        characterId: cid,
        qualification: 2,
        qualificationType: QualificationType.NORMAL,
        isConsumable: false,
      }),
    );
    await this.specRepo.save(
      this.specRepo.create({
        characterId: cid,
        primarySpecialty: dto.profession,
        secondarySpecialties: [],
        efficiency: { primary: 1.0, secondary: 1.0 },
      }),
    );
    await this.combatRepo.save(
      this.combatRepo.create({ characterId: cid, style: CombatStyle.BALANCED }),
    );
    await this.resRepo.save(
      this.resRepo.create({
        characterId: cid,
        food: 0,
        wood: 0,
        iron: 0,
        herb: 0,
        gold: 0,
      }),
    );
    await this.consumeRepo.save(
      this.consumeRepo.create({
        characterId: cid,
        foodPerDay: 9,
        minFood: 3,
        hungerDays: 0,
        status: HungerStatus.NORMAL,
      }),
    );
    await this.memRepo.save(
      this.memRepo.create({
        characterId: cid,
        employers: [],
        interactions: [],
        secrets: [],
        friends: [],
        enemies: [],
        rumors: [],
      }),
    );
    await this.espRepo.save(
      this.espRepo.create({
        characterId: cid,
        canSpy: false,
        canInfiltrate: false,
        espionageLevel: 0,
      }),
    );
    await this.compRepo.save(
      this.compRepo.create({
        characterId: cid,
        isFollowing: false,
        companionType: CompanionType.NONE,
        sacrificeUsed: false,
      }),
    );
    await this.darkRepo.save(
      this.darkRepo.create({
        characterId: cid,
        isDarkened: false,
        powerBoost: 1.5,
      }),
    );
    await this.needsRepo.save(
      this.needsRepo.create({
        characterId: cid,
        survival: 50,
        safety: 50,
        belonging: 50,
        esteem: 50,
        actualization: 50,
      }),
    );

    // Initialize 4 martial arts
    for (const artType of [
      MartialArtType.FIST,
      MartialArtType.PALM,
      MartialArtType.LEG,
      MartialArtType.WEAPON,
    ]) {
      await this.maRepo.save(
        this.maRepo.create({ characterId: cid, artType, level: 0, skills: [] }),
      );
    }

    return saved;
  }

  async getFullProfile(characterId: string): Promise<FullCharacterProfile> {
    const character = await this.charRepo.findOne({
      where: { id: characterId },
    });
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }

    const where = { where: { characterId } };
    return {
      character,
      attribute: await this.attrRepo.findOne(where),
      status: await this.statusRepo.findOne(where),
      faction: await this.factionRepo.findOne(where),
      location: await this.locRepo.findOne(where),
      profile: await this.profileRepo.findOne(where),
      qualification: await this.qualRepo.findOne(where),
      specialty: await this.specRepo.findOne(where),
      combatStyle: await this.combatRepo.findOne(where),
      resource: await this.resRepo.findOne(where),
      consumption: await this.consumeRepo.findOne(where),
      memory: await this.memRepo.findOne(where),
      espionage: await this.espRepo.findOne(where),
      companion: await this.compRepo.findOne(where),
      darkened: await this.darkRepo.findOne(where),
      needs: await this.needsRepo.findOne(where),
      martialArts: await this.maRepo.find(where),
      relationships: await this.relRepo.find(where),
    };
  }

  async getByPlayerId(playerId: string): Promise<Character | null> {
    return this.charRepo.findOne({ where: { playerId } });
  }

  async getById(id: string): Promise<Character | null> {
    return this.charRepo.findOne({ where: { id } });
  }

  // ===== Sub-table update methods =====

  async updateAttribute(
    characterId: string,
    updates: Partial<CharacterAttribute>,
  ): Promise<CharacterAttribute> {
    const attr = await this.attrRepo.findOne({ where: { characterId } });
    if (!attr) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '属性记录不存在');
    }
    Object.assign(attr, updates);
    return this.attrRepo.save(attr);
  }

  async updateLocation(
    characterId: string,
    updates: Partial<CharacterLocation>,
  ): Promise<CharacterLocation> {
    const loc = await this.locRepo.findOne({ where: { characterId } });
    if (!loc) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '位置记录不存在');
    }
    Object.assign(loc, updates);
    return this.locRepo.save(loc);
  }

  async updateStatus(
    characterId: string,
    updates: Partial<CharacterStatus>,
  ): Promise<CharacterStatus> {
    const status = await this.statusRepo.findOne({ where: { characterId } });
    if (!status) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '状态记录不存在');
    }
    Object.assign(status, updates);
    return this.statusRepo.save(status);
  }

  async updateFaction(
    characterId: string,
    updates: Partial<CharacterFaction>,
  ): Promise<CharacterFaction> {
    const faction = await this.factionRepo.findOne({ where: { characterId } });
    if (!faction) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '阵营记录不存在');
    }
    Object.assign(faction, updates);
    return this.factionRepo.save(faction);
  }

  async updateResource(
    characterId: string,
    updates: Partial<CharacterResource>,
  ): Promise<CharacterResource> {
    const res = await this.resRepo.findOne({ where: { characterId } });
    if (!res) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '物资记录不存在');
    }
    Object.assign(res, updates);
    return this.resRepo.save(res);
  }

  async upsertMartialArt(
    characterId: string,
    artType: MartialArtType,
    level: number,
    skills?: any,
  ): Promise<CharacterMartialArt> {
    let ma = await this.maRepo.findOne({ where: { characterId, artType } });
    if (ma) {
      ma.level = level;
      if (skills !== undefined) ma.skills = skills;
    } else {
      ma = this.maRepo.create({
        characterId,
        artType,
        level,
        skills: skills ?? [],
      });
    }
    return this.maRepo.save(ma);
  }

  async getMartialArts(characterId: string): Promise<CharacterMartialArt[]> {
    return this.maRepo.find({ where: { characterId } });
  }

  async addRelationship(
    characterId: string,
    targetId: string,
    favorability: number,
  ): Promise<CharacterRelationship> {
    const rel = this.relRepo.create({ characterId, targetId, favorability });
    return this.relRepo.save(rel);
  }

  async getRelationships(
    characterId: string,
  ): Promise<CharacterRelationship[]> {
    return this.relRepo.find({ where: { characterId } });
  }
}
