import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AdminUser } from '../src/modules/auth/entities/admin-user.entity';
import { AdminRole } from '../src/constants/enums';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'game_user',
    password: process.env.DB_PASSWORD || 'game_pass',
    database: process.env.DB_DATABASE || 'game_server',
    entities: [AdminUser],
    synchronize: true,
  });

  await dataSource.initialize();

  const adminRepo = dataSource.getRepository(AdminUser);
  const existing = await adminRepo.findOne({ where: { username: 'admin' } });

  if (existing) {
    console.log('Admin user already exists, skipping seed.');
    await dataSource.destroy();
    return;
  }

  const password =
    process.env.ADMIN_DEFAULT_PASSWORD || 'change-me-on-first-login';
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = adminRepo.create({
    username: 'admin',
    passwordHash,
    role: AdminRole.SUPER_ADMIN,
    isActive: true,
  });

  await adminRepo.save(admin);
  console.log(`Default admin user created: admin / ${password}`);
  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
