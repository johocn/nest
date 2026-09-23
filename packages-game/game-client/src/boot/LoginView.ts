import { Api } from '../net/api';
import type { AuthResult } from '../net/api';
import { ApiError } from '../net/http';
import { Session } from '../net/Session';
import { Platform } from '../platform/Platform';
import { Toast } from '../ui/Toast';

export class LoginView {
  static show(onLoggedIn: () => void): void {
    Platform.ui.showLogin({
      onSubmit: async (username, password) => {
        let result: AuthResult | null = null;

        try {
          result = await Api.login(username, password);
        } catch (loginErr) {
          if (!(loginErr instanceof ApiError)) throw loginErr;
          try {
            result = await Api.register(username, password, username);
            Toast.info('账号不存在，已自动注册');
          } catch (regErr) {
            const msg = regErr instanceof ApiError ? regErr.message : String(regErr);
            throw new ApiError(-1, `登录失败：${msg}（若账号已存在，请检查密码）`);
          }
        }

        Session.save(result);
        Platform.ui.hideLogin();
        Toast.info(`登录成功：playerId=${result.playerId}`);
        onLoggedIn();
      },
    });
  }
}