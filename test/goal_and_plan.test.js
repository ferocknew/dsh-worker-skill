import assert from 'node:assert/strict';
import test from 'node:test';
import { DSHClient } from '../src/dsh-client.js';

test('DSHClient Goal Mode - 目标状态查询与解析', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token'
  });

  // 1. 无目标状态
  client.getProjections = async (sessionId) => {
    return {
      asOfSeq: 1,
      values: { goal: null }
    };
  };
  const emptyGoal = await client.getGoal('session-1');
  assert.equal(emptyGoal, null);

  // 2. 有活跃目标
  client.getProjections = async (sessionId) => {
    return {
      asOfSeq: 2,
      values: {
        goal: {
          id: 'goal-uuid-123',
          revision: 2,
          objective: '重构小红书关注模块并验证',
          phase: 'active',
          roundsStarted: 5,
          maxGoalRounds: 256
        }
      }
    };
  };
  const activeGoal = await client.getGoal('session-1');
  assert.ok(activeGoal);
  assert.equal(activeGoal.objective, '重构小红书关注模块并验证');
  assert.equal(activeGoal.phase, 'active');
  assert.equal(activeGoal.roundsStarted, 5);
});

test('DSHClient Goal Mode - 控制指令与生命周期事件下发', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token'
  });

  const dispatched = [];
  client.sendPrompt = async (sessionId, promptText, options) => {
    dispatched.push({ sessionId, promptText });
    return { accepted: true, requestId: 'req-mock' };
  };

  // 1. 设置目标
  await client.setGoal('sess-1', '编写测试并跑通');
  assert.equal(dispatched[0].promptText, '/goal 编写测试并跑通');

  // 2. 暂停目标
  await client.pauseGoal('sess-1');
  assert.equal(dispatched[1].promptText, '/goal pause');

  // 3. 恢复目标
  await client.resumeGoal('sess-1');
  assert.equal(dispatched[2].promptText, '/goal resume');

  // 4. 清除目标
  await client.clearGoal('sess-1');
  assert.equal(dispatched[3].promptText, '/goal clear');

  // 5. 编辑目标
  await client.editGoal('sess-1', '新目标描述');
  assert.equal(dispatched[4].promptText, '/goal edit 新目标描述');

  // 6. 空目标参数安全防护
  await assert.rejects(async () => {
    await client.setGoal('sess-1', '   ');
  }, /Objective cannot be empty/);
});

test('DSHClient Plan Mode - 计划模式控制与状态', async () => {
  const client = new DSHClient({
    host: 'http://localhost:53080',
    token: 'test-token'
  });

  const prompts = [];
  client.sendPrompt = async (sessionId, promptText) => {
    prompts.push(promptText);
    return { accepted: true };
  };

  // 开启
  await client.setPlan('sess-2', 'on');
  assert.equal(prompts[0], '/plan');

  // 默认开启
  await client.setPlan('sess-2');
  assert.equal(prompts[1], '/plan');

  // 关闭
  await client.setPlan('sess-2', 'off');
  assert.equal(prompts[2], '/plan off');

  // 附带指导文本
  await client.setPlan('sess-2', '先调研再出计划书');
  assert.equal(prompts[3], '/plan 先调研再出计划书');
});
