import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export class DSHTimeoutError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'DSHTimeoutError';
    this.sessionId = context.sessionId;
    this.timeoutMs = context.timeoutMs;
    this.lastStep = context.lastStep || 0;
    this.lastSeq = context.lastSeq || 0;
    this.tokens = context.tokens || 0;
    this.cancelled = Boolean(context.cancelled);
    this.resumable = !context.cancelled;
  }
}

export class DSHClient {
  constructor(options = {}) {
    this.host = (options.host || config.host).replace(/\/$/, '');
    this.token = options.token || config.token;
    this.timeoutMs = options.timeoutMs || config.timeoutMs;
    this.pollIntervalMs = options.pollIntervalMs || config.pollIntervalMs;
    this.cookie = options.cookie || null;
    this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }

  async ensureAuth() {
    if (this.cookie) return;
    if (!this.token) {
      throw new Error('DSH Token is required. Please set DSH_TOKEN environment variable or configure token in ~/.config/dsh/config.json');
    }
    const loginUrl = `${this.host}/?token=${encodeURIComponent(this.token)}`;
    const parsed = new URL(loginUrl);

    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          agent: this.httpsAgent,
          headers: { Host: parsed.host }
        },
        (res) => {
          const setCookies = res.headers['set-cookie'];
          if (setCookies && setCookies.length > 0) {
            this.cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
          }
          res.resume();
          resolve();
        }
      );
      req.on('error', reject);
      req.end();
    });

    if (!this.cookie) {
      throw new Error(`Failed to authenticate with DSH at ${this.host}`);
    }
  }

  async callRpc(method, args = {}) {
    await this.ensureAuth();
    const parsed = new URL(`${this.host}/api/${method}`);
    const rpcId = crypto.randomUUID();
    const payload = JSON.stringify({
      type: 'client-request',
      rpcId,
      method,
      payload: { args }
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname,
          method: 'POST',
          agent: this.httpsAgent,
          headers: {
            Host: parsed.host,
            Origin: this.host,
            Cookie: this.cookie,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            try {
              const data = JSON.parse(raw);
              if (data.type === 'server-response') {
                if (data.result && data.result.ok === false) {
                  return reject(new Error(`RPC ${method} error: ${JSON.stringify(data.result.error)}`));
                }
                return resolve(data.result ? data.result.value : data);
              }
              resolve(data);
            } catch (err) {
              reject(new Error(`Invalid JSON response from ${method}: ${raw.slice(0, 200)}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * 列出指定基础目录下的所有工作区目录
   */
  async listWorkspaces(basePath = config.defaultWorkspaceBase) {
    const listRes = await this.callRpc('directoryPicker/list', { path: basePath });
    const entries = (listRes && listRes.entries) ? listRes.entries : [];
    const results = [];

    for (const item of entries) {
      const fullPath = item.path || path.posix.join(basePath, item.name);
      try {
        const ws = await this.resolveWorkspace(fullPath);
        results.push({
          name: item.name,
          path: fullPath,
          workspaceId: ws.workspaceId,
          title: ws.title || item.name,
          sessions: ws.sessionIds || ws.sessions || []
        });
      } catch {
        results.push({
          name: item.name,
          path: fullPath,
          workspaceId: null,
          sessions: []
        });
      }
    }
    return results;
  }

  /**
   * 解析或绑定一个工作区路径，获取 workspaceId
   */
  async resolveWorkspace(workspacePath) {
    const res = await this.callRpc('workspace/create', {
      request: { path: workspacePath }
    });
    return res.workspace || res;
  }

  /**
   * 在指定工作区下创建会话
   */
  async createSession(workspaceId, title = '') {
    const req = { workspaceId };
    if (title) req.title = title;
    const res = await this.callRpc('session/create', { request: req });
    return res;
  }

  /**
   * 向指定会话上传文件（Base64 方式）
   */
  async uploadFile(sessionId, filePath, customName = '') {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    const fileName = customName || path.basename(resolvedPath);
    const fileBytes = fs.readFileSync(resolvedPath);
    const b64Data = fileBytes.toString('base64');

    const res = await this.callRpc('fileUploads/upload', {
      agentId: sessionId,
      request: {
        name: fileName,
        data: b64Data
      }
    });
    return res; // { receiptId, file: { attachmentId, name, bytes } }
  }

  /**
   * 向会话下发任务与提示词
   */
  async sendPrompt(sessionId, promptText, options = {}) {
    const { receiptIds = [], mode = 'queue', requestId = crypto.randomUUID() } = options;
    const content = [];

    for (const rId of receiptIds) {
      content.push({ type: 'file', receiptId: rId });
    }
    content.push({ type: 'text', text: promptText });

    const res = await this.callRpc('session/prompt', {
      request: {
        requestId,
        sessionId,
        mode,
        content
      }
    });
    return res;
  }

  /**
   * 获取当前会话状态与统计
   */
  async getProjections(sessionId) {
    const res = await this.callRpc('session/projections', {
      request: { sessionId }
    });
    return res;
  }

  /**
   * 获取会话消息记录
   */
  async getPage(sessionId, throughSeq, maxMessages = 20) {
    const res = await this.callRpc('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq,
        maxMessages
      }
    });
    return res;
  }

  /**
   * 等待会话完成并获取最终回复与工具执行概要
   */
  async waitForCompletion(sessionId, options = {}) {
    const {
      onProgress = null,
      timeoutMs = this.timeoutMs,
      pollIntervalMs = this.pollIntervalMs,
      cancelOnTimeout = false,
      throwOnTimeout = true
    } = options;

    const startTime = Date.now();
    let lastSeq = 0;
    let lastStep = 0;
    let lastStats = {};

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const proj = await this.getProjections(sessionId);
      const asOfSeq = proj.asOfSeq || 0;
      const vals = proj.values || {};
      const stats = vals.sessionStats || {};
      lastStats = stats;
      const currentStep = stats.steps || 0;
      const running = vals.running !== false; // 如果为 false 说明当前 turn 完成

      if (currentStep > lastStep || asOfSeq > lastSeq) {
        lastStep = currentStep;
        lastSeq = asOfSeq;
        if (onProgress) {
          onProgress({
            step: currentStep,
            turns: stats.turns || 1,
            seq: asOfSeq,
            llmMs: stats.llmMs,
            toolMs: stats.toolMs,
            decodeTokens: stats.decodeTokens
          });
        }
      }

      // 如果 turnOutline 中已有完整的 response 说明当前 turn 已经完全 settle
      const outline = vals.turnOutline || [];
      const latestTurn = outline[outline.length - 1];
      if (latestTurn && typeof latestTurn.response === 'string' && latestTurn.response.length > 0) {
        // 获取完整的助手消息
        let fullText = latestTurn.response;
        try {
          const page = await this.getPage(sessionId, asOfSeq, 30);
          const records = page.records || [];
          for (const r of records) {
            const evt = r.event || {};
            if (evt.type === 'assistant/message') {
              const msg = evt.data?.message;
              const textParts = msg?.content?.filter((p) => p.type === 'text');
              if (textParts && textParts.length > 0) {
                fullText = textParts.map((p) => p.text).join('\n');
              }
            }
          }
        } catch {
          // ignore fallback to response in turnOutline
        }

        return {
          status: 'completed',
          title: vals.title || '',
          sessionId,
          turns: stats.turns || 1,
          steps: stats.steps || 0,
          tokens: stats.decodeTokens || 0,
          response: fullText,
          stats
        };
      }
    }

    let cancelled = false;
    if (cancelOnTimeout) {
      try {
        await this.cancelSession(sessionId);
        cancelled = true;
      } catch (err) {
        // ignore cancel failure
      }
    }

    const timeoutDetails = {
      status: 'timeout',
      sessionId,
      timeoutMs,
      lastStep,
      lastSeq,
      tokens: lastStats.decodeTokens || 0,
      cancelled,
      resumable: !cancelled,
      message: cancelled
        ? `Session ${sessionId} timed out after ${timeoutMs}ms and was cancelled on remote DSH.`
        : `Session ${sessionId} timed out after ${timeoutMs}ms. The agent is STILL RUNNING on remote DSH! Do not restart as a new session. Resume waiting with: dsh-worker wait ${sessionId}`
    };

    if (!throwOnTimeout) {
      return timeoutDetails;
    }

    throw new DSHTimeoutError(timeoutDetails.message, timeoutDetails);
  }

  /**
   * 取消指定会话的当前轮次执行
   */
  async cancelSession(sessionId) {
    const res = await this.callRpc('session/cancel', {
      request: { sessionId }
    });
    return res;
  }

  /**
   * 获取指定会话绑定的工作区根目录
   */
  async getWorkspaceRoot(sessionId) {
    const proj = await this.getProjections(sessionId);
    return proj.values?.workingDirectory || '';
  }

  /**
   * 解析工作区内的文件路径（支持相对路径与绝对路径）
   */
  async resolveWorkspaceFilePath(sessionId, targetPath = '') {
    const root = await this.getWorkspaceRoot(sessionId);
    if (!targetPath || targetPath === '.' || targetPath === '/') {
      return root;
    }
    if (path.posix.isAbsolute(targetPath)) {
      return targetPath;
    }
    return path.posix.join(root, targetPath);
  }

  /**
   * 列出工作区指定目录下的文件与子目录
   */
  async listWorkspaceFiles(sessionId, targetPath = '') {
    const fullPath = await this.resolveWorkspaceFilePath(sessionId, targetPath);
    const res = await this.callRpc('workspaceFiles/list', {
      workspaceFileScopeId: sessionId,
      path: fullPath
    });
    return {
      workspaceRoot: await this.getWorkspaceRoot(sessionId),
      path: res.path || fullPath,
      entries: res.entries || [],
      truncated: Boolean(res.truncated)
    };
  }

  /**
   * 读取工作区指定文件的内容
   */
  async readWorkspaceFile(sessionId, filePath, options = {}) {
    const { offset = 1, limit = 200 } = options;
    const fullPath = await this.resolveWorkspaceFilePath(sessionId, filePath);
    const res = await this.callRpc('workspaceFiles/read', {
      workspaceFileScopeId: sessionId,
      path: fullPath,
      range: { offset, limit }
    });
    return res;
  }

  /**
   * 列出指定会话的终端列表与环境
   */
  async getTerminalInfo(sessionId) {
    const [terminals, shells, env] = await Promise.all([
      this.callRpc('terminal/list', { sessionId }).catch(() => []),
      this.callRpc('terminal/shells', { agentId: sessionId }).catch(() => []),
      this.callRpc('terminal/environment', { agentId: sessionId }).catch(() => ({}))
    ]);
    return {
      terminals: terminals || [],
      shells: shells || [],
      environment: env || {}
    };
  }

  /**
   * 终止会话下运行的后台任务
   */
  async killJob(sessionId, jobId) {
    const res = await this.callRpc('job/kill', {
      request: { sessionId, jobId }
    });
    return res;
  }

  /**
   * 获取会话全景详情（工作目录、待办列表、规划步骤、上下文压力、Token 详情等）
   */
  async getSessionDetails(sessionId) {
    const proj = await this.getProjections(sessionId);
    const v = proj.values || {};
    return {
      sessionId,
      title: v.title || '',
      goal: v.goal || null,
      workingDirectory: v.workingDirectory || '',
      todos: v.todos || [],
      plan: v.plan || null,
      tokenUsage: v.tokenUsage || null,
      contextPressure: v.contextPressure || null,
      sessionStats: v.sessionStats || null,
      agentPreset: v.agentPreset || null,
      subagent: v.subagent || null,
      agentTeam: v.agentTeam || null,
      userQuestions: v.userQuestions || []
    };
  }

  /**
   * 获取目标模式（Goal Mode）状态
   */
  async getGoal(sessionId) {
    const proj = await this.getProjections(sessionId);
    return proj.values?.goal || null;
  }

  /**
   * 设定目标并激活目标模式（持久化跨轮次自主推进）
   */
  async setGoal(sessionId, objective) {
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      throw new Error('Objective cannot be empty');
    }
    return this.sendPrompt(sessionId, `/goal ${objective.trim()}`);
  }

  /**
   * 暂停目标模式执行
   */
  async pauseGoal(sessionId) {
    return this.sendPrompt(sessionId, '/goal pause');
  }

  /**
   * 恢复目标模式执行
   */
  async resumeGoal(sessionId) {
    return this.sendPrompt(sessionId, '/goal resume');
  }

  /**
   * 清除当前目标
   */
  async clearGoal(sessionId) {
    return this.sendPrompt(sessionId, '/goal clear');
  }

  /**
   * 修改当前目标内容
   */
  async editGoal(sessionId, objective) {
    if (!objective || typeof objective !== 'string' || !objective.trim()) {
      throw new Error('Objective cannot be empty');
    }
    return this.sendPrompt(sessionId, `/goal edit ${objective.trim()}`);
  }

  /**
   * 获取计划模式（Plan Mode）状态
   */
  async getPlan(sessionId) {
    const proj = await this.getProjections(sessionId);
    return proj.values?.plan || null;
  }

  /**
   * 控制计划模式：开启、关闭或携带指导指令启动
   */
  async setPlan(sessionId, actionOrPrompt = 'on') {
    const trimmed = (actionOrPrompt || '').trim();
    if (trimmed === 'off') {
      return this.sendPrompt(sessionId, '/plan off');
    }
    if (!trimmed || trimmed === 'on') {
      return this.sendPrompt(sessionId, '/plan');
    }
    return this.sendPrompt(sessionId, `/plan ${trimmed}`);
  }
}
