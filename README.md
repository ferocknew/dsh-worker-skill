# DSH Worker Skill 🤖✨

> DeepSeek Harness (DSH) worker orchestrator and automation CLI for AI agents.

将局域网内的 **DeepSeek Harness (DSH)** 实例纳管为主 Agent（如 Hermes、Claude Code 等）的专属工作小弟，实现工作区感知、文件安全投递、任务分派与执行进度全生命周期回收。

---

## 🌟 核心特性

- 🚀 **Node.js 24 原生设计**：零重量级外部依赖，基于现代 Fetch/HTTPS/Crypto/Util 构建，对 AI CLI 与自动化流极度友好。
- 📁 **工作区深度透视**：自动探查 `/workspace/code` 下的所有代码目录，支持动态解析或绑定 `workspaceId`。
- 📎 **原生文件流附件**：通过 DSH RPC `fileUploads/upload` 将文件打入会话上下文，Agent 可无缝 `read`。
- 🔄 **实时心跳与状态回收**：自动轮询或监听 Agent 工具调用序列、Token 消耗、Step 轮次与最终答复。
- 📦 **AI 友好输出**：所有子命令均原生支持 `--json`，便于上层编排 Agent 结构化解析。

---

## 🛠️ 安装与快速开始

### 运行环境
- Node.js >= 22 (推荐 Node 24+)

### 快速配置
可通过环境变量或配置文件指定 DSH 实例：

```bash
export DSH_HOST="https://<your-dsh-host>:53080"
export DSH_TOKEN="your-dsh-token"
```

或者在 `~/.config/dsh/config.json` 中配置：
```json
{
  "host": "https://<your-dsh-host>:53080",
  "token": "your-dsh-token"
}
```

---

## 💻 CLI 命令速查

```bash
# 1. 查看所有可用工作区
dsh-worker workspaces

# 2. 一键派单并等待结果（创建会话 -> 上传附件 -> 派发任务 -> 等待执行完成）
dsh-worker run \
  --workspace /workspace/code/memory_server_http \
  --prompt "请根据附件方案完成单元测试编写" \
  --file ./spec.md \
  --wait

# 3. 工作区文件透视与核验（免猜测直读工作区源码）
dsh-worker files <sessionId>               # 列出工作区根目录文件
dsh-worker files <sessionId> src           # 列出指定子目录
dsh-worker cat <sessionId> src/main.py     # 读取代码文件（支持 --offset 和 --limit）

# 4. 会话全景透视（查看 Plan 规划步骤、Todos 清单、Token 详细消耗）
dsh-worker details <sessionId>

# 5. 终端环境与可用 Shell 感知
dsh-worker terminals <sessionId>

# 6. 后台长任务强行终止（防死锁 / 释放资源）
dsh-worker kill-job <sessionId> <jobId>

# 7. 查看会话状态与工具执行日志
dsh-worker status <sessionId>
dsh-worker logs <sessionId> --limit 20

# 8. 断网重连、超时续查与防重复执行（Twitter 架构最佳实践）
# 当网络波动中断或客户端等待超时，远端任务仍在执行，不要重复派发新任务，直接凭同一 sessionId 续查挂载：
dsh-worker wait <sessionId> [--timeout 600000]

# 若确需主动终止远端当前正在执行的轮次（释放计算资源）：
dsh-worker cancel <sessionId>
# 或在派发时声明超时即取消：
dsh-worker run --workspace /workspace/code/repo --prompt "..." --wait --cancel-on-timeout
```

---

## 🛡️ 稳健性与断网容灾设计 (Robustness & Idempotency)

1. **防重跑与幂等性保障**：只要 DSH 服务端已成功接单并分配 `sessionId`，无论客户端由于网络中断还是超时退出，客户端均**不会将超时判定为失败重跑**。上层保留 `sessionId`，即可随时通过 `dsh-worker wait <sessionId>` 无缝接回监听。
2. **结构化 `DSHTimeoutError`**：SDK 抛出的错误对象包含 `sessionId`、`tokens`、`lastStep` 以及 `resumable: true` 标记，方便编排框架实现智能重试与状态挂载。
3. **主动熔断与取消**：支持通过 `dsh-worker cancel <sessionId>` 或 `--cancel-on-timeout` 显式调用 RPC `session/cancel`，中止当前活跃 turn，不浪费 GPU/Tokens。
4. **单元测试保障**：内置 `test/timeout_and_resume.test.js`，严格验证断网重连恢复、仅执行一份单据与超时取消。

---

## 📄 许可协议

MIT License.
