---
name: dsh-worker-skill
description: Use when controlling DeepSeek Harness (DSH) workers. Orchestrates DSH sessions, uploads files, dispatches prompts, and collects results via Node.js CLI.
---

# DeepSeek Harness (DSH) Worker Skill

本 Skill 用于将 DeepSeek Harness (DSH) 容器纳管为后台 Worker 子代理（Sub-agent），实现跨工作区派单、文件安全投递、代码自动化修改与长耗时任务监控。

## 适用场景
- 需让 DSH 针对特定工作区（如 `/workspace/code/memory_server_http`）执行代码分析、阅读与重构。
- 需要以附件（Attachment）形式将本地报告或配置文件交由 DSH Agent 查阅。
- 需要在主会话中挂起等待（或异步轮询）DSH 的多步工具执行与最终总结反馈。

## 环境与配置
连接 DSH 容器实例时，建议通过环境变量或配置文件提供凭据：
- `DSH_HOST`：例如 `https://127.0.0.1:53080` 或内网服务地址
- `DSH_TOKEN`：访问 Token（可配置于 `~/.config/dsh/config.json`，权限建议设为 600）
- 运行依赖：Node.js >= 22 (推荐 Node 24/26)

## CLI 快速使用

### 1. 发现可用工作区
```bash
node bin/dsh-worker.js workspaces
# 或输出纯 JSON
node bin/dsh-worker.js workspaces --json
```

### 2. 一键派单并等待结果（推荐）
```bash
node bin/dsh-worker.js run \
  --workspace /workspace/code/memory_server_http \
  --prompt "请阅读附件中的改进方案，完成 src/service/mem/entity.py 的自动向量 Hook 改造" \
  --file /opt/data/aimem_architecture_pitfalls_and_improvements.md \
  --wait
```

### 3. 分步操作

#### 创建会话
```bash
node bin/dsh-worker.js create-session /workspace/code/memory_server_http --title "内存服务重构"
```

#### 上传文件附件
```bash
node bin/dsh-worker.js upload <session-id> /path/to/file.md
```

#### 派发 Prompt
```bash
node bin/dsh-worker.js prompt <session-id> "请阅读附件内容并总结" --file /path/to/file.md --wait
```

#### 查询会话状态与进度
```bash
node bin/dsh-worker.js status <session-id>
```

#### 查看会话步骤日志
```bash
node bin/dsh-worker.js logs <session-id> --limit 30
```

## 核心接口说明 (Node.js API)

```javascript
import { DSHClient } from './src/dsh-client.js';

const client = new DSHClient({
  host: process.env.DSH_HOST || 'https://<your-dsh-host>:53080',
  token: process.env.DSH_TOKEN || '<your-dsh-token>'
});

// 1. 获取工作区元数据
const ws = await client.resolveWorkspace('/workspace/code/memory_server_http');

// 2. 创建会话
const session = await client.createSession(ws.workspaceId, '重构任务');

// 3. 上传文件并下发任务
const upload = await client.uploadFile(session.sessionId, './task.md');
await client.sendPrompt(session.sessionId, '请执行 task.md 里的步骤', {
  receiptIds: [upload.receiptId]
});

// 4. 等待完成并回收报告
const result = await client.waitForCompletion(session.sessionId);
console.log(result.response);
```

## 踩坑经验与红线
1. **网络与证书**：DSH 采用自签名证书，内部通信必须允许 `rejectUnauthorized: false`。
2. **文件附件双轨安全**：通过 `fileUploads/upload` 上传附件是 DSH 原生的 staging 机制，会为 prompt 注入 `attachmentId`；若需要 DSH 内部直接以相对路径读取工作区物理文件，可辅助落盘至工作区挂载目录。
3. **文件删除安全红线**：严禁在生产或持久化宿主机上私自执行未确认的 `rm` 破坏性操作。
