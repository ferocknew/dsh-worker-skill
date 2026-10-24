import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

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
      pollIntervalMs = this.pollIntervalMs
    } = options;

    const startTime = Date.now();
    let lastSeq = 0;
    let lastStep = 0;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const proj = await this.getProjections(sessionId);
      const asOfSeq = proj.asOfSeq || 0;
      const vals = proj.values || {};
      const stats = vals.sessionStats || {};
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

      // 如果 turnOutline 中已有完整的 response 且不再处于活跃调用中
      const outline = vals.turnOutline || [];
      const latestTurn = outline[outline.length - 1];
      if (latestTurn && latestTurn.response && !running) {
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

    throw new Error(`Session ${sessionId} timed out after ${timeoutMs}ms`);
  }
}
