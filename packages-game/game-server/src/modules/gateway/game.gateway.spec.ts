import { Test, TestingModule } from '@nestjs/testing';
import { GameGateway } from './game.gateway';
import { ConnectionService } from './connection.service';
import { AuthService } from '@modules/auth/auth.service';
import { WorldService } from '@modules/world/world.service';
import { ChatService } from '@modules/chat/chat.service';
import { JwtService } from '@nestjs/jwt';

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
});
