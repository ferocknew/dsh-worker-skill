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

# 3. 单独向指定会话发送提示词
dsh-worker prompt <sessionId> "请继续检查代码质量" --wait

# 4. 查看会话状态与 Token 统计
dsh-worker status <sessionId>

# 5. 查看会话工具执行详情
dsh-worker logs <sessionId> --limit 20
```

---

## 📄 许可协议

MIT License.
