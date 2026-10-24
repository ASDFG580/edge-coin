# 将 EDGE//COIN 开放到公网

游戏已经内置完整的 8 人联机：房间码、邀请链接、轮流 / 齐射、AI 补位、15 秒倒计时和房主权威同步都不需要再开发。要做的只是把 `server.js` 放到一台公网可访问的机器上。

## 目前已经可用的联机

| 范围 | 地址 |
| --- | --- |
| 本机 | <http://127.0.0.1:8130/> |
| 同一局域网 | <http://10.218.17.217:8130/> |
| 本机其他虚拟网卡 | <http://172.19.163.2:8130/> |

同一 Wi-Fi / 局域网内的朋友直接打开局域网地址即可创建或加入房间。如果打不开，需要在 Windows 防火墙放行 TCP 8130。

## 方案一：Render（最快得到公网 HTTPS 地址）

1. 把整个项目目录推到 GitHub（不要提交 `dist/`、`.shots/` 和浏览器测试配置）。
2. 在 Render 新建 **Web Service**，连接这个仓库。
3. 运行环境选 Node，Build Command 填 `npm install --omit=dev`，Start Command 填 `node server.js`。
4. 部署完成后会得到类似 `https://edge-coin.onrender.com` 的地址，把它发给朋友即可。

项目自带 `render.yaml`，也可以在 Render 里直接使用 Blueprint 部署。

免费实例休眠后第一次访问会慢几秒；房间状态保存在内存里，重启会清空未开始的房间。

## 方案二：Docker / VPS

在有公网 IP 的服务器上：

```bash
docker build -t edge-coin .
docker run -d --name edge-coin --restart unless-stopped -p 8130:8130 edge-coin
```

然后在安全组 / 防火墙放行 TCP 8130，访问：

```text
http://你的服务器公网IP:8130/
```

生产环境建议前面加 Nginx / Caddy 反向代理并启用 HTTPS。SSE 需要关闭代理缓冲；Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:8130;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

## 方案三：临时隧道

本机运行服务器后，在另一台有公网出口的机器上使用 Cloudflare Tunnel：

```bash
cloudflared tunnel --url http://localhost:8130
```

或使用 ngrok：

```bash
ngrok http 8130
```

隧道地址只适合临时测试，电脑关机或隧道关闭后房间会断开。

## 部署注意事项

- 房间和快照状态保存在**单个 Node 进程内存**中，不要开多个副本做无状态负载均衡；必须保持单实例或使用粘性会话。
- 服务端已经读取平台注入的 `PORT`；平台给什么端口就用什么端口。
- 静态客户端和联机 API 由同一个 `server.js` 提供，不需要额外前端服务器。
- 邀请链接会使用当前浏览器的地址生成，所以一定要从最终的公开域名打开游戏。
- 服务器没有任何 npm 依赖，`node server.js` 即可启动。
