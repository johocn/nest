import { Test, TestingModule } from '@nestjs/testing';
import { GameGateway } from './game.gateway';
import { ConnectionService } from './connection.service';
import { AuthService } from '@modules/auth/auth.service';
import { WorldService } from '@modules/world/world.service';
import { ChatService } from '@modules/chat/chat.service';
import { JwtService } from '@nestjs/jwt';
import { BuildingState } from '@constants/enums';

describe('GameGateway', () => {
  let gateway: GameGateway;
  let connectionService: jest.Mocked<ConnectionService>;
  let authService: jest.Mocked<AuthService>;
  let worldService: jest.Mocked<WorldService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameGateway,
        {
          provide: ConnectionService,
          useValue: {
            playerConnect: jest.fn(),
            playerDisconnect: jest.fn(),
            isOnline: jest.fn(),
            updateHeartbeat: jest.fn(),
            updatePlayerScene: jest.fn(),
            getPlayerConnection: jest.fn(),
            getPlayerBySocket: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: { validateToken: jest.fn() },
        },
        {
          provide: WorldService,
          useValue: {
            checkEnterRequirement: jest.fn(),
            enterScene: jest.fn(),
            leaveScene: jest.fn(),
            getScene: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { verify: jest.fn() },
        },
        {
          provide: ChatService,
          useValue: {
            getSenderName: jest.fn().mockResolvedValue('test'),
            sendChannelMessage: jest.fn().mockResolvedValue({
              message: {
                id: '1',
                content: 'hello',
              },
              supportReply: null,
            }),
          },
        },
      ],
    }).compile();

    gateway = module.get(GameGateway);
    connectionService = module.get(ConnectionService);
    authService = module.get(AuthService);
    worldService = module.get(WorldService);
    jwtService = module.get(JwtService);
  });

  const mockClient = (id: string) => ({
    id,
    data: {} as any,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: { query: {}, address: '127.0.0.1' },
  });

  describe('handleConnection', () => {
    it('should reject connection without token', async () => {
      const client = mockClient('socket1');
      await gateway.handleConnection(client as any);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should reject connection with invalid token', async () => {
      const client = mockClient('socket1');
      client.handshake.query = { token: 'bad-token' };
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      await gateway.handleConnection(client as any);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should accept connection with valid token', async () => {
      const client = mockClient('socket1');
      client.handshake.query = { token: 'valid-token' };
      jwtService.verify.mockReturnValue({
        accountId: 'a1',
        playerId: 'p1',
        tokenVersion: 1,
      });
      authService.validateToken.mockResolvedValue(true);
      await gateway.handleConnection(client as any);
      expect(client.data.playerId).toBe('p1');
      expect(connectionService.playerConnect).toHaveBeenCalledWith(
        'p1',
        'socket1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should reject when token version mismatch', async () => {
      const client = mockClient('socket1');
      client.handshake.query = { token: 'valid-token' };
      jwtService.verify.mockReturnValue({
        accountId: 'a1',
        playerId: 'p1',
        tokenVersion: 1,
      });
      authService.validateToken.mockResolvedValue(false);
      await gateway.handleConnection(client as any);
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should clean up connection on disconnect', async () => {
      const client = mockClient('socket1');
      client.data.playerId = 'p1';
      client.data.sceneId = '1';
      await gateway.handleDisconnect(client as any);
      expect(worldService.leaveScene).toHaveBeenCalledWith('p1', '1');
      expect(connectionService.playerDisconnect).toHaveBeenCalledWith(
        'p1',
        'disconnect',
      );
    });
  });

  describe('handleHeartbeat', () => {
    it('should update heartbeat timestamp', async () => {
      const client = mockClient('socket1');
      client.data.playerId = 'p1';
      await gateway.handleHeartbeat(client as any, { seq: 1 });
      expect(connectionService.updateHeartbeat).toHaveBeenCalledWith('p1');
      expect(client.emit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({ cmd: 'player.heartbeat', code: 0 }),
      );
    });
  });

  describe('handleEnterScene', () => {
    it('should enter scene and join room', async () => {
      const client = mockClient('socket1');
      client.data.playerId = 'p1';
      worldService.checkEnterRequirement.mockResolvedValue(undefined);
      worldService.enterScene.mockResolvedValue({
        scene: { id: '1', name: '中央城' } as any,
        spawns: [],
        triggers: [],
      });
      const result = await gateway.handleEnterScene(client as any, {
        seq: 1,
        data: { sceneId: '1' },
      });
      expect(client.join).toHaveBeenCalledWith('scene:1');
      expect(client.data.sceneId).toBe('1');
      expect(connectionService.updatePlayerScene).toHaveBeenCalledWith(
        'p1',
        '1',
      );
    });

    it('should leave old scene when switching', async () => {
      const client = mockClient('socket1');
      client.data.playerId = 'p1';
      client.data.sceneId = 'old_scene';
      worldService.checkEnterRequirement.mockResolvedValue(undefined);
      worldService.enterScene.mockResolvedValue({
        scene: { id: '2', name: '黑森林' } as any,
        spawns: [],
        triggers: [],
      });
      await gateway.handleEnterScene(client as any, {
        seq: 1,
        data: { sceneId: '2' },
      });
      expect(client.leave).toHaveBeenCalledWith('scene:old_scene');
      expect(worldService.leaveScene).toHaveBeenCalledWith('p1', 'old_scene');
    });
  });

  describe('handleMove', () => {
    it('should broadcast position to scene room', async () => {
      const client = mockClient('socket1');
      client.data.playerId = 'p1';
      client.data.sceneId = '1';
      const toEmit = jest.fn();
      const server = { to: jest.fn().mockReturnValue({ emit: toEmit }) } as any;
      gateway.setServer(server);
      await gateway.handleMove(client as any, {
        seq: 1,
        data: { x: 100, y: 200, rotation: 90 },
      });
      expect(server.to).toHaveBeenCalledWith('scene:1');
      expect(toEmit).toHaveBeenCalledWith(
        'message',
        expect.objectContaining({
          cmd: 'world.entity_update',
          data: expect.objectContaining({
            playerId: 'p1',
            pos: { x: 100, y: 200 },
          }),
        }),
      );
    });
  });

  describe('handleBuildingStateChanged', () => {
    /** 假命名空间：房间表挂在 adapter.rooms（与 @WebSocketServer() 实为 Namespace 一致） */
    const mockServerWithRooms = (rooms: Map<string, { size: number }>) => {
      const toEmit = jest.fn();
      const server = {
        to: jest.fn().mockReturnValue({ emit: toEmit }),
        adapter: { rooms },
      } as any;
      return { server, toEmit };
    };

    const payload = (overrides: Record<string, any> = {}) => ({
      sceneId: '1',
      buildingId: '77',
      templateId: '55',
      ownerId: '1001',
      state: BuildingState.BUILDING,
      x: 96,
      y: 160,
      rotation: 0,
      ...overrides,
    });

    it('should emit entity_update frame identical in shape to NPC precedent', () => {
      const { server, toEmit } = mockServerWithRooms(
        new Map([['scene:1', { size: 2 }]]),
      );
      gateway.setServer(server);

      gateway.handleBuildingStateChanged(payload());

      expect(server.to).toHaveBeenCalledWith('scene:1');
      expect(toEmit).toHaveBeenCalledTimes(1);
      expect(toEmit).toHaveBeenCalledWith('message', {
        cmd: 'world.entity_update',
        seq: 0,
        code: 0,
        msg: 'success',
        data: {
          entityId: 'building:77',
          entityType: 'building',
          buildingId: '77',
          templateId: '55',
          playerId: null,
          pos: { x: 96, y: 160 },
          rotation: 0,
          state: 'building',
        },
      });
    });

    it('should share frame envelope and field names with handleNpcPositions', () => {
      const { server, toEmit } = mockServerWithRooms(
        new Map([['scene:1', { size: 1 }]]),
      );
      gateway.setServer(server);

      gateway.handleNpcPositions({
        sceneId: '1',
        npcs: [{ npcId: 'npc:5', npcTemplateId: '9', x: 10, y: 20 }],
      });
      const npcFrame = toEmit.mock.calls[0][1];
      toEmit.mockClear();

      gateway.handleBuildingStateChanged(payload());
      const buildingFrame = toEmit.mock.calls[0][1];

      expect(Object.keys(buildingFrame).sort()).toEqual(
        Object.keys(npcFrame).sort(),
      );
      expect(buildingFrame.cmd).toBe(npcFrame.cmd);
      expect(buildingFrame.seq).toBe(npcFrame.seq);
      expect(buildingFrame.code).toBe(npcFrame.code);
      expect(buildingFrame.msg).toBe(npcFrame.msg);
      // 与 NPC 先例共有的 data 字段名逐字一致，仅多带 buildingId/templateId
      expect(Object.keys(buildingFrame.data).sort()).toEqual([
        'buildingId',
        'entityId',
        'entityType',
        'playerId',
        'pos',
        'rotation',
        'state',
        'templateId',
      ]);
      expect(buildingFrame.data.playerId).toBeNull();
      expect(Object.keys(npcFrame.data)).toEqual(
        expect.arrayContaining(['entityId', 'entityType', 'pos', 'rotation', 'state']),
      );
    });

    it('should not emit when room is missing', () => {
      const { server, toEmit } = mockServerWithRooms(new Map());
      gateway.setServer(server);

      gateway.handleBuildingStateChanged(payload());

      expect(server.to).not.toHaveBeenCalled();
      expect(toEmit).not.toHaveBeenCalled();
    });

    it('should not emit when room is empty', () => {
      const { server, toEmit } = mockServerWithRooms(
        new Map([['scene:1', { size: 0 }]]),
      );
      gateway.setServer(server);

      gateway.handleBuildingStateChanged(payload());

      expect(server.to).not.toHaveBeenCalled();
      expect(toEmit).not.toHaveBeenCalled();
    });

    it('should broadcast all three building states', () => {
      const { server, toEmit } = mockServerWithRooms(
        new Map([['scene:1', { size: 1 }]]),
      );
      gateway.setServer(server);

      for (const state of [
        BuildingState.BUILDING,
        BuildingState.BUILT,
        BuildingState.DEMOLISHING,
      ]) {
        gateway.handleBuildingStateChanged(payload({ state }));
      }

      expect(toEmit).toHaveBeenCalledTimes(3);
      expect(toEmit.mock.calls.map((call) => call[1].data.state)).toEqual([
        'building',
        'built',
        'demolishing',
      ]);
    });
  });
});
