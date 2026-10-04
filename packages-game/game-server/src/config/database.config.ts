import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => {
    // ConfigModule.forRoot 已在 shared.module.ts 正确加载 .env
    // 这里在 registerAs 回调里读，确保 dotenv 已生效
    const dbType = process.env.DB_TYPE || 'postgres';
    console.log('[database.config] type =', dbType);

    if (dbType === 'sqljs') {
      return {
        type: 'sqljs',
        entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
        synchronize: true,
        logging: false,
      } as TypeOrmModuleOptions;
    }

    return {
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'game_user',
      password: process.env.DB_PASSWORD || 'game_pass',
      database: process.env.DB_DATABASE || 'game_server',
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
      migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      logging: process.env.DB_LOGGING === 'true',
    };
  },
);
