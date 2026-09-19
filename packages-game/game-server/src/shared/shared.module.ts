import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import * as Joi from 'joi';
import databaseConfig from '@config/database.config';
import redisConfig from '@config/redis.config';
import jwtConfig from '@config/jwt.config';
import gameConfig from '@config/game.config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env',
      load: [databaseConfig, redisConfig, jwtConfig, gameConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        APP_PORT: Joi.number().default(3000),
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_DATABASE: Joi.string().required(),
        DB_SYNCHRONIZE: Joi.boolean().default(false),
        DB_LOGGING: Joi.boolean().default(false),
        DB_MIGRATIONS_RUN: Joi.boolean().default(false),
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().allow('').default(''),
        REDIS_DB: Joi.number().default(0),
        JWT_SECRET: Joi.string().when('NODE_ENV', {
          is: 'production',
          then: Joi.string()
            .min(16)
            .disallow(
              'your-jwt-secret-key-change-in-production',
              'default-secret',
              'default-secret-change-me',
            )
            .required(),
          otherwise: Joi.string().default('default-secret-change-me'),
        }),
        JWT_EXPIRES_IN: Joi.string().default('7d'),
        PAYMENT_CALLBACK_SECRET: Joi.string().when('NODE_ENV', {
          is: 'production',
          then: Joi.string().min(16).required(),
          otherwise: Joi.string().default('mock-secret'),
        }),
        CORS_ORIGINS: Joi.string().default('http://localhost:3000'),
        ADMIN_DEFAULT_PASSWORD: Joi.string().default(
          'change-me-on-first-login',
        ),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get('database')!,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password') || undefined,
          db: config.get('redis.db'),
          enableOfflineQueue: true,
          connectTimeout: 5000,
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => {
            if (times > 3) return null;
            return Math.min(times * 500, 2000);
          },
        },
      }),
    }),
  ],
  exports: [ConfigModule, TypeOrmModule],
})
export class SharedModule {}
