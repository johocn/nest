import io, os, shutil, time

BLOCK = """
    # ddz（斗地主 H5：静态 + /api、/socket.io 走下方默认反代到 game-server:3000）
    location = /ddz { return 301 /ddz/; }
    location ^~ /ddz/ {
        alias /www/sites/game.joho.cn/ddz/;
        index ddz.html;
        try_files $uri $uri/ /ddz/ddz.html;
    }
"""

files = [
    '/opt/1panel/apps/openresty/openresty/conf/conf.d/game.joho.cn-ssl.conf',
    '/opt/1panel/apps/openresty/openresty/conf/conf.d/game.joho.cn.conf',
]
ts = time.strftime('%Y%m%d_%H%M%S')
for path in files:
    with io.open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    if '/ddz/' in text:
        print('skip (already present):', path)
        continue
    shutil.copy2(path, path + '.bak_ddz_' + ts)
    idx = text.rstrip().rfind('}')
    text = text[:idx] + BLOCK + text[idx:]
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('patched:', path)
