import assert from 'node:assert/strict';
import test from 'node:test';
import { DSHClient, DSHTimeoutError } from '../src/dsh-client.js';

test('DSHClient - 超时只报警不中断，保留 sessionId 支持续查 (Resumable)', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token',
    timeoutMs: 100,
    pollIntervalMs: 20
  });

  // Mock getProjections: 模拟任务还在运行中
  let pollCount = 0;
  client.getProjections = async (sessionId) => {
    pollCount++;
    return {
      asOfSeq: 10 + pollCount,
      values: {
        running: true,
        sessionStats: { steps: pollCount, turns: 1, decodeTokens: pollCount * 50 }
      }
    };
  };

  client.cancelSession = async (sessionId) => {
    throw new Error('should not be called by default');
  };

  try {
    await client.waitForCompletion('session-test-123', {
      timeoutMs: 80,
      pollIntervalMs: 15,
      cancelOnTimeout: false
    });
    assert.fail('Should have timed out');
  } catch (err) {
    assert.ok(err instanceof DSHTimeoutError);
    assert.equal(err.sessionId, 'session-test-123');
    assert.equal(err.resumable, true);
    assert.equal(err.cancelled, false);
    assert.ok(err.message.includes('STILL RUNNING'));
    assert.ok(err.message.includes('dsh-worker wait session-test-123'));
  }
});

test('DSHClient - 开启 cancelOnTimeout 时超时应主动取消远端任务', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token'
  });

  client.getProjections = async (sessionId) => {
    return {
      asOfSeq: 5,
      values: {
        running: true,
        sessionStats: { steps: 2, turns: 1 }
      }
    };
  };

  let cancelCalled = false;
  client.cancelSession = async (sessionId) => {
    assert.equal(sessionId, 'session-test-cancel');
    cancelCalled = true;
    return { accepted: true };
  };

  try {
    await client.waitForCompletion('session-test-cancel', {
      timeoutMs: 50,
      pollIntervalMs: 10,
      cancelOnTimeout: true
    });
    assert.fail('Should have timed out');
  } catch (err) {
    assert.ok(err instanceof DSHTimeoutError);
    assert.equal(cancelCalled, true);
    assert.equal(err.cancelled, true);
    assert.equal(err.resumable, false);
    assert.ok(err.message.includes('cancelled on remote DSH'));
  }
});

test('DSHClient - 断网重连后凭同一 sessionId 续查成功 (只执行一份，不重复发单)', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token'
  });

  // 模拟之前执行到第 5 步超时，断网重连后恢复轮询，第 2 轮完成
  let pollRound = 0;
  client.getProjections = async (sessionId) => {
    pollRound++;
    if (pollRound < 3) {
      return {
        asOfSeq: 100,
        values: {
          running: true,
          sessionStats: { steps: 5 + pollRound, turns: 1 }
        }
      };
    }
    return {
      asOfSeq: 105,
      values: {
        running: false,
        title: '已完成的重构任务',
        turnOutline: [{ response: '代码重构并单测全部通过！' }],
        sessionStats: { steps: 8, turns: 1, decodeTokens: 4200 }
      }
    };
  };

  client.getPage = async () => ({ records: [] });

  const result = await client.waitForCompletion('session-test-resume', {
    timeoutMs: 500,
    pollIntervalMs: 20
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.sessionId, 'session-test-resume');
  assert.equal(result.response, '代码重构并单测全部通过！');
  assert.equal(result.steps, 8);
});
