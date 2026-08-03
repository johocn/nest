import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // 注册与 main.ts 一致的全局管道/过滤器/拦截器
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/health (GET) should return 200 with ok status', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.msg).toBe('success');
    expect(response.body.data.status).toBeDefined();
    expect(response.body.data.db).toBeDefined();
    expect(response.body.data.redis).toBeDefined();
  });

  it('unknown route should return 404 with error code', async () => {
    const response = await request(app.getHttpServer()).get('/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe(404);
  });

  it('POST /api/client/v1/auth/register should create account and return token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2euser1',
        password: 'test123456',
        nickname: 'E2EHero1',
      });

    expect(response.status).toBe(201);
    expect(response.body.code).toBe(0);
    expect(response.body.data.token).toBeDefined();
    expect(response.body.data.accountId).toBeDefined();
    expect(response.body.data.playerId).toBeDefined();
  });

  it('POST /api/client/v1/auth/login should return token', async () => {
    await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2euser2',
        password: 'test123456',
        nickname: 'E2EHero2',
      });

    const response = await request(app.getHttpServer())
      .post('/api/client/v1/auth/login')
      .send({ username: 'e2euser2', password: 'test123456' });

    expect(response.status).toBe(201);
    expect(response.body.code).toBe(0);
    expect(response.body.data.token).toBeDefined();
  });

  it('GET /api/client/v1/player/base-info should return player data', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2euser3',
        password: 'test123456',
        nickname: 'E2EHero3',
      });
    const token = regRes.body.data.token;

    const response = await request(app.getHttpServer())
      .get('/api/client/v1/player/base-info')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.player.nickname).toBe('E2EHero3');
    expect(response.body.data.currencies).toHaveLength(2);
  });

  it('GET /api/client/v1/player/base-info without token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/client/v1/player/base-info',
    );

    expect(response.status).toBe(401);
  });

  // ===== Character E2E Tests =====

  it('POST /api/client/v1/character/create should create character', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar1',
        password: 'test123456',
        nickname: 'E2ECharHero1',
      });
    const token = regRes.body.data.token;

    const response = await request(app.getHttpServer())
      .post('/api/client/v1/character/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '张三丰',
        nickname: '张真人',
        profession: 'monk',
        gender: 'male',
        age: 30,
      });

    expect(response.status).toBe(201);
    expect(response.body.code).toBe(0);
    expect(response.body.data.name).toBe('张三丰');
    expect(response.body.data.nickname).toBe('张真人');
    expect(response.body.data.profession).toBe('monk');
    expect(response.body.data.isNpc).toBe(false);
  });

  it('GET /api/client/v1/character/profile should return full profile', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar2',
        password: 'test123456',
        nickname: 'E2ECharHero2',
      });
    const token = regRes.body.data.token;

    // Create character first
    await request(app.getHttpServer())
      .post('/api/client/v1/character/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '李逍遥',
        nickname: '逍遥哥',
        profession: 'guard',
        gender: 'male',
        age: 22,
      });

    const response = await request(app.getHttpServer())
      .get('/api/client/v1/character/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.character.name).toBe('李逍遥');
    expect(response.body.data.attribute).toBeDefined();
    expect(response.body.data.attribute.strength).toBe(10);
    expect(response.body.data.status).toBeDefined();
    expect(response.body.data.status.isAlive).toBe(true);
    expect(response.body.data.faction).toBeDefined();
    expect(response.body.data.faction.faction).toBe('neutral');
    expect(response.body.data.location).toBeDefined();
    expect(response.body.data.martialArts).toHaveLength(4);
  });

  it('PUT /api/client/v1/character/attribute should update attribute', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar3',
        password: 'test123456',
        nickname: 'E2ECharHero3',
      });
    const token = regRes.body.data.token;

    await request(app.getHttpServer())
      .post('/api/client/v1/character/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '王重阳',
        nickname: '重阳子',
        profession: 'scholar',
        gender: 'male',
        age: 45,
      });

    const response = await request(app.getHttpServer())
      .put('/api/client/v1/character/attribute')
      .set('Authorization', `Bearer ${token}`)
      .send({ strength: 50, speed: 30, defense: 40 });

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.strength).toBe(50);
    expect(response.body.data.speed).toBe(30);
    expect(response.body.data.defense).toBe(40);
  });

  it('PUT /api/client/v1/character/martial-art should upsert martial art', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar4',
        password: 'test123456',
        nickname: 'E2ECharHero4',
      });
    const token = regRes.body.data.token;

    await request(app.getHttpServer())
      .post('/api/client/v1/character/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '黄药师',
        nickname: '东邪',
        profession: 'doctor',
        gender: 'male',
        age: 50,
      });

    const response = await request(app.getHttpServer())
      .put('/api/client/v1/character/martial-art')
      .set('Authorization', `Bearer ${token}`)
      .send({
        artType: 'fist',
        level: 50,
        skills: [{ name: '降龙十八掌', damage: 999 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data.level).toBe(50);
    expect(response.body.data.artType).toBe('fist');
  });

  it('GET /api/client/v1/character/profile without character should return error', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar5',
        password: 'test123456',
        nickname: 'E2ECharHero5',
      });
    const token = regRes.body.data.token;

    const response = await request(app.getHttpServer())
      .get('/api/client/v1/character/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200); // GameException returns HTTP 200
    expect(response.body.code).toBe(10010); // PLAYER_NOT_FOUND
  });

  it('POST /api/client/v1/character/create with invalid profession should return validation error', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2echar6',
        password: 'test123456',
        nickname: 'E2ECharHero6',
      });
    const token = regRes.body.data.token;

    const response = await request(app.getHttpServer())
      .post('/api/client/v1/character/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '测试',
        nickname: '测试',
        profession: 'invalid_profession',
        gender: 'male',
        age: 20,
      });

    expect(response.status).toBe(400); // ValidationPipe returns 400
  });

  // ===== Inventory E2E Tests =====

  it('GET /api/client/v1/inventory/list should return player inventory', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/client/v1/auth/register')
      .send({
        username: 'e2einv1',
        password: 'test123456',
        nickname: 'E2EInvHero1',
      });
    const token = regRes.body.data.token;

    const response = await request(app.getHttpServer())
      .get('/api/client/v1/inventory/list')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.code).toBe(0);
    expect(response.body.data).toEqual([]);
  });

  it('GET /api/client/v1/inventory/list without token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/client/v1/inventory/list',
    );

    expect(response.status).toBe(401);
  });

  // ===== World E2E Tests =====

  it('GET /api/admin/v1/world/scene/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/world/scene/list',
    );

    expect(response.status).toBe(401);
  });

  // ===== Combat E2E Tests =====

  it('GET /api/admin/v1/skill/template/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/skill/template/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/buff/template/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/buff/template/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/combat/log/c1 without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/combat/log/c1',
    );

    expect(response.status).toBe(401);
  });

  // ===== Phase 7 E2E Tests =====

  it('GET /api/admin/v1/quest/template/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/quest/template/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/mail/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/mail/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/client/v1/social/friend/list without token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/client/v1/social/friend/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/ops/online without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/ops/online',
    );

    expect(response.status).toBe(401);
  });

  // ===== Phase 8 E2E Tests =====

  it('GET /api/client/v1/notice/list without token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/client/v1/notice/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/notice/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/notice/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/chat/log/list without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/chat/log/list',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/admin/v1/server/status without admin token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/v1/server/status',
    );

    expect(response.status).toBe(401);
  });

  it('GET /api/client/v1/ranking/power without token should return 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/client/v1/ranking/power',
    );

    expect(response.status).toBe(401);
  });
});
