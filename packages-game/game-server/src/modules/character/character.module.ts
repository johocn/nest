import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';
import { CharacterAdminController } from './character-admin.controller';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
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
    ]),
  ],
  controllers: [CharacterController, CharacterAdminController],
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
