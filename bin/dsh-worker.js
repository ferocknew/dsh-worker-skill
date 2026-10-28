#!/usr/bin/env node

import { parseArgs } from 'node:util';
import path from 'node:path';
import { DSHClient } from '../src/dsh-client.js';

const USAGE = `
dsh-worker - DeepSeek Harness (DSH) Worker Orchestrator CLI

Usage:
  dsh-worker workspaces [--base <path>] [--json]
  dsh-worker create-session <workspace-path> [--title <title>] [--json]
  dsh-worker upload <session-id> <file-path> [--name <custom-name>] [--json]
  dsh-worker prompt <session-id> <prompt-text> [--file <path>] [--wait] [--json]
  dsh-worker run --workspace <path> --prompt <text> [--file <path>] [--wait] [--cancel-on-timeout] [--timeout <ms>] [--json]
  dsh-worker wait <session-id> [--timeout <ms>] [--cancel-on-timeout] [--json]
  dsh-worker cancel <session-id> [--json]
  dsh-worker status <session-id> [--json]
  dsh-worker details <session-id> [--json]
  dsh-worker logs <session-id> [--limit <n>] [--json]
  dsh-worker files <session-id> [path] [--json]
  dsh-worker cat <session-id> <file-path> [--offset <n>] [--limit <n>] [--json]
  dsh-worker terminals <session-id> [--json]
  dsh-worker kill-job <session-id> <job-id> [--json]
  dsh-worker goal <session-id> [action|objective] [--wait] [--json]
  dsh-worker plan <session-id> [on|off|<prompt>] [--wait] [--json]

Options:
  --host                DSH Host (default: $DSH_HOST or http://localhost:53080)
  --token               DSH Token (default: $DSH_TOKEN)
  --json                Output raw JSON response
  --wait                Wait for agent execution to complete
  --file                Attach a local file to the session prompt
  --timeout             Timeout in milliseconds for waiting (default: 600000)
  --cancel-on-timeout   Cancel the remote DSH session turn if wait times out (default: false, keeps running)
  --offset              Line offset for reading files (default: 1)
  --limit               Line limit for reading files or logs (default: 200/20)
  --help, -h            Show this help message
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE.trim());
    process.exit(0);
  }

  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: {
      host: { type: 'string' },
      token: { type: 'string' },
      base: { type: 'string' },
      title: { type: 'string' },
      name: { type: 'string' },
      file: { type: 'string' },
      workspace: { type: 'string' },
      prompt: { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string' },
      timeout: { type: 'string' },
      'cancel-on-timeout': { type: 'boolean', default: false },
      wait: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false }
    },
    allowPositionals: true
  });

  const client = new DSHClient({
    host: values.host,
    token: values.token
  });

  try {
    switch (command) {
      case 'workspaces':
      case 'ws': {
        const list = await client.listWorkspaces(values.base);
        if (values.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log('=== Available DSH Workspaces ===');
          for (const ws of list) {
            console.log(`📁 ${ws.name}`);
            console.log(`   Path: ${ws.path}`);
            console.log(`   Workspace ID: ${ws.workspaceId || 'unbound'}`);
            console.log(`   Sessions: ${ws.sessions.length}`);
            console.log('');
          }
        }
        break;
      }

      case 'create-session': {
        const wsPath = positionals[0] || values.workspace;
        if (!wsPath) {
          throw new Error('Missing workspace path. Usage: dsh-worker create-session <workspace-path>');
        }
        const wsInfo = await client.resolveWorkspace(wsPath);
        const sessionRes = await client.createSession(wsInfo.workspaceId, values.title || '');
        if (values.json) {
          console.log(JSON.stringify({ workspace: wsInfo, session: sessionRes }, null, 2));
        } else {
          console.log(`✓ Workspace resolved: ${wsInfo.workspaceId}`);
          console.log(`✓ Session created: ${sessionRes.sessionId}`);
        }
        break;
      }

      case 'upload': {
        const sessionId = positionals[0];
        const filePath = positionals[1] || values.file;
        if (!sessionId || !filePath) {
          throw new Error('Usage: dsh-worker upload <session-id> <file-path>');
        }
        const uploadRes = await client.uploadFile(sessionId, filePath, values.name);
        if (values.json) {
          console.log(JSON.stringify(uploadRes, null, 2));
        } else {
          console.log(`✓ File uploaded successfully`);
          console.log(`  Receipt ID: ${uploadRes.receiptId}`);
          console.log(`  Attachment ID: ${uploadRes.file?.attachmentId}`);
          console.log(`  Size: ${uploadRes.file?.bytes} bytes`);
        }
        break;
      }

      case 'prompt': {
        const sessionId = positionals[0];
        const promptText = positionals[1] || values.prompt;
        if (!sessionId || !promptText) {
          throw new Error('Usage: dsh-worker prompt <session-id> <prompt-text> [--file <path>] [--wait]');
        }

        const receiptIds = [];
        if (values.file) {
          if (!values.json) console.log(`Uploading file ${values.file}...`);
          const up = await client.uploadFile(sessionId, values.file);
          receiptIds.push(up.receiptId);
          if (!values.json) console.log(`✓ File attached: receipt ${up.receiptId}`);
        }

        const res = await client.sendPrompt(sessionId, promptText, { receiptIds });
        if (!values.wait) {
          if (values.json) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(`✓ Prompt dispatched to session ${sessionId}. Accepted: ${res.accepted}`);
          }
          break;
        }

        if (!values.json) console.log(`Waiting for session ${sessionId} to complete...`);
        const result = await client.waitForCompletion(sessionId, {
          timeoutMs: values.timeout ? parseInt(values.timeout, 10) : undefined,
          cancelOnTimeout: values['cancel-on-timeout'],
          onProgress: (p) => {
            if (!values.json) {
              process.stdout.write(`\r[Step ${p.step}] seq: ${p.seq}, tokens: ${p.decodeTokens || 0}... `);
            }
          }
        });

        if (values.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\n\n=== Agent Response ===');
          console.log(result.response);
          console.log('\n=== Stats ===');
          console.log(`Title: ${result.title}`);
          console.log(`Turns: ${result.turns}, Steps: ${result.steps}, Tokens: ${result.tokens}`);
        }
        break;
      }

      case 'run': {
        const wsPath = values.workspace || positionals[0];
        const promptText = values.prompt || positionals[1];
        if (!wsPath || !promptText) {
          throw new Error('Usage: dsh-worker run --workspace <path> --prompt <text> [--file <path>] [--wait]');
        }

        if (!values.json) console.log(`1. Resolving workspace ${wsPath}...`);
        const wsInfo = await client.resolveWorkspace(wsPath);

        if (!values.json) console.log(`2. Creating session in workspace ${wsInfo.workspaceId}...`);
        const sessionRes = await client.createSession(wsInfo.workspaceId);
        const sessionId = sessionRes.sessionId;

        const receiptIds = [];
        if (values.file) {
          if (!values.json) console.log(`3. Uploading file ${values.file}...`);
          const up = await client.uploadFile(sessionId, values.file);
          receiptIds.push(up.receiptId);
        }

        if (!values.json) console.log(`4. Dispatching task to session ${sessionId}...`);
        await client.sendPrompt(sessionId, promptText, { receiptIds });

        if (!values.wait && values.wait !== false) {
          // run 默认等待完成
        }

        if (!values.json) console.log(`5. Worker agent is running...`);
        const result = await client.waitForCompletion(sessionId, {
          timeoutMs: values.timeout ? parseInt(values.timeout, 10) : undefined,
          cancelOnTimeout: values['cancel-on-timeout'],
          onProgress: (p) => {
            if (!values.json) {
              process.stdout.write(`\r[Step ${p.step}] tokens: ${p.decodeTokens || 0}... `);
            }
          }
        });

        if (values.json) {
          console.log(JSON.stringify({ sessionId, workspaceId: wsInfo.workspaceId, result }, null, 2));
        } else {
          console.log('\n\n=== Final Result ===');
          console.log(result.response);
          console.log('\n=== Execution Summary ===');
          console.log(`Session ID: ${sessionId}`);
          console.log(`Title: ${result.title}`);
          console.log(`Turns: ${result.turns}, Steps: ${result.steps}, Tokens: ${result.tokens}`);
        }
        break;
      }

      case 'wait': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker wait <session-id> [--timeout <ms>] [--cancel-on-timeout]');
        if (!values.json) console.log(`Attaching to session ${sessionId} and waiting for completion...`);
        const result = await client.waitForCompletion(sessionId, {
          timeoutMs: values.timeout ? parseInt(values.timeout, 10) : undefined,
          cancelOnTimeout: values['cancel-on-timeout'],
          onProgress: (p) => {
            if (!values.json) {
              process.stdout.write(`\r[Step ${p.step}] seq: ${p.seq}, tokens: ${p.decodeTokens || 0}... `);
            }
          }
        });

        if (values.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\n\n=== Agent Response ===');
          console.log(result.response);
          console.log('\n=== Stats ===');
          console.log(`Title: ${result.title}`);
          console.log(`Turns: ${result.turns}, Steps: ${result.steps}, Tokens: ${result.tokens}`);
        }
        break;
      }

      case 'cancel': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker cancel <session-id>');
        const res = await client.cancelSession(sessionId);
        if (values.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`✓ Active turn in session ${sessionId} cancelled: accepted = ${res.accepted}`);
        }
        break;
      }

      case 'status': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker status <session-id>');
        const proj = await client.getProjections(sessionId);
        if (values.json) {
          console.log(JSON.stringify(proj, null, 2));
        } else {
          const vals = proj.values || {};
          const stats = vals.sessionStats || {};
          console.log(`=== Session Status: ${sessionId} ===`);
          console.log(`Title: ${vals.title || 'untitled'}`);
          console.log(`Directory: ${vals.workingDirectory || '-'}`);
          console.log(`Running: ${vals.running !== false}`);
          console.log(`Turns: ${stats.turns || 0}, Steps: ${stats.steps || 0}`);
          console.log(`Tokens: ${stats.decodeTokens || 0}`);
        }
        break;
      }

      case 'details': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker details <session-id>');
        const details = await client.getSessionDetails(sessionId);
        if (values.json) {
          console.log(JSON.stringify(details, null, 2));
        } else {
          console.log(`=== Session Full Details: ${sessionId} ===`);
          console.log(`Title: ${details.title || 'untitled'}`);
          console.log(`Goal: ${details.goal || 'none'}`);
          console.log(`Workspace CWD: ${details.workingDirectory}`);
          console.log(`Stats: Steps: ${details.sessionStats?.steps || 0}, Turns: ${details.sessionStats?.turns || 0}, Tokens: ${details.sessionStats?.decodeTokens || 0}`);
          console.log(`Context Pressure: ${JSON.stringify(details.contextPressure || {})}`);
          if (details.todos && details.todos.length > 0) {
            console.log('\n--- Todos ---');
            for (const t of details.todos) {
              console.log(` [${t.completed ? 'x' : ' '}] ${t.content || t.title}`);
            }
          }
          if (details.plan && details.plan.steps) {
            console.log('\n--- Plan Steps ---');
            for (const s of details.plan.steps) {
              console.log(` - ${s.title || s.description}`);
            }
          }
        }
        break;
      }

      case 'files': {
        const sessionId = positionals[0];
        const subPath = positionals[1] || '';
        if (!sessionId) throw new Error('Usage: dsh-worker files <session-id> [path]');
        const res = await client.listWorkspaceFiles(sessionId, subPath);
        if (values.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`=== Workspace Files (${sessionId}) ===`);
          console.log(`Root: ${res.workspaceRoot}`);
          console.log(`Target: ${res.path || '.'}\n`);
          for (const item of res.entries) {
            const icon = item.type === 'directory' ? '📁' : '📄';
            const size = item.size !== undefined ? `(${item.size} bytes)` : '';
            console.log(`${icon} ${item.name.padEnd(30)} ${size}`);
          }
        }
        break;
      }

      case 'cat': {
        const sessionId = positionals[0];
        const targetFile = positionals[1];
        if (!sessionId || !targetFile) throw new Error('Usage: dsh-worker cat <session-id> <file-path> [--offset <n>] [--limit <n>]');
        const offset = parseInt(values.offset || '1', 10);
        const limit = parseInt(values.limit || '200', 10);
        const fileRes = await client.readWorkspaceFile(sessionId, targetFile, { offset, limit });
        if (values.json) {
          console.log(JSON.stringify(fileRes, null, 2));
        } else {
          console.log(`=== File: ${fileRes.absolutePath} (lines ${fileRes.offset}-${fileRes.offset + (fileRes.lines || 0) - 1}) ===`);
          console.log(fileRes.text || '');
          if (!fileRes.eof) {
            console.log(`\n[... truncated, total bytes: ${fileRes.bytes}. Use --offset ${offset + limit} to continue ...]`);
          }
        }
        break;
      }

      case 'terminals': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker terminals <session-id>');
        const term = await client.getTerminalInfo(sessionId);
        if (values.json) {
          console.log(JSON.stringify(term, null, 2));
        } else {
          console.log(`=== Terminals & Environment (${sessionId}) ===`);
          console.log(`Workspace CWD: ${term.environment?.cwd || '-'}`);
          console.log(`Available Shells: ${term.shells.map((s) => s.path).join(', ') || 'none'}`);
          console.log(`Active Terminals: ${term.terminals.length}`);
          for (const t of term.terminals) {
            console.log(` - ID: ${t.id}, Title: ${t.title || 'untitled'}`);
          }
        }
        break;
      }

      case 'kill-job': {
        const sessionId = positionals[0];
        const jobId = positionals[1];
        if (!sessionId || !jobId) throw new Error('Usage: dsh-worker kill-job <session-id> <job-id>');
        const res = await client.killJob(sessionId, jobId);
        if (values.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`✓ Job ${jobId} kill request outcome: ${res.outcome}`);
        }
        break;
      }

      case 'logs': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker logs <session-id>');
        const proj = await client.getProjections(sessionId);
        const asOfSeq = proj.asOfSeq || 100;
        const limit = parseInt(values.limit || '20', 10);
        const page = await client.getPage(sessionId, asOfSeq, limit);
        if (values.json) {
          console.log(JSON.stringify(page, null, 2));
        } else {
          console.log(`=== Session Logs (${sessionId}) through seq ${asOfSeq} ===`);
          const records = page.records || [];
          for (const r of records) {
            const evt = r.event || {};
            const d = evt.data || {};
            if (evt.type === 'tool/call') {
              console.log(`🛠️ [Tool Call] ${d.name}(${d.arguments?.slice(0, 100)})`);
            } else if (evt.type === 'assistant/message') {
              console.log(`🤖 [Assistant Step ${d.step}]`);
            }
          }
        }
        break;
      }

      case 'goal': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker goal <session-id> [action|objective] [--wait]');

        const subAction = positionals[1];
        const remainingArgs = positionals.slice(2).join(' ').trim();
        const fullArg = positionals.slice(1).join(' ').trim();

        // 1. 无参数或显式 status：查询目标状态
        if (!fullArg || fullArg === 'status') {
          const goal = await client.getGoal(sessionId);
          if (values.json) {
            console.log(JSON.stringify(goal, null, 2));
          } else if (!goal) {
            console.log(`ℹ️ No active goal for session ${sessionId}.`);
            console.log(`  Set a goal with: dsh-worker goal ${sessionId} "<objective>"`);
          } else {
            const phaseIcons = {
              active: '🟢 Active (自主运行中)',
              paused: '⏸️ Paused (已暂停)',
              blocked: '🚫 Blocked (阻塞)',
              complete: '✅ Complete (已达成)'
            };
            console.log(`=== Goal Status: ${sessionId} ===`);
            console.log(`Objective: ${goal.objective}`);
            console.log(`Phase: ${phaseIcons[goal.phase] || goal.phase}`);
            console.log(`Rounds: ${goal.roundsStarted || 0} / ${goal.maxGoalRounds || 256}`);
            if (goal.blockerReason) {
              console.log(`Blocker: ${goal.blockerReason}`);
            }
            if (goal.revision) {
              console.log(`Revision: ${goal.revision}`);
            }
          }
          break;
        }

        let res;
        let actionDesc = '';
        if (subAction === 'pause') {
          res = await client.pauseGoal(sessionId);
          actionDesc = 'Goal paused';
        } else if (subAction === 'resume') {
          res = await client.resumeGoal(sessionId);
          actionDesc = 'Goal resumed';
        } else if (subAction === 'clear') {
          res = await client.clearGoal(sessionId);
          actionDesc = 'Goal cleared';
        } else if (subAction === 'edit') {
          if (!remainingArgs) throw new Error('Usage: dsh-worker goal <session-id> edit <new-objective>');
          res = await client.editGoal(sessionId, remainingArgs);
          actionDesc = `Goal updated: ${remainingArgs}`;
        } else if (subAction === 'set') {
          if (!remainingArgs) throw new Error('Usage: dsh-worker goal <session-id> set <objective>');
          res = await client.setGoal(sessionId, remainingArgs);
          actionDesc = `Goal set: ${remainingArgs}`;
        } else {
          // 直接将后续所有字符当做目标指令
          res = await client.setGoal(sessionId, fullArg);
          actionDesc = `Goal set: ${fullArg}`;
        }

        if (values.json && !values.wait) {
          console.log(JSON.stringify(res, null, 2));
        } else if (!values.wait) {
          console.log(`✓ ${actionDesc} for session ${sessionId}. Accepted: ${res?.accepted}`);
        }

        if (values.wait) {
          if (!values.json) console.log(`Waiting for goal turn completion on session ${sessionId}...`);
          const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : undefined;
          const turnRes = await client.waitForCompletion(sessionId, {
            timeoutMs,
            cancelOnTimeout: values['cancel-on-timeout'],
            onProgress: (p) => {
              if (!values.json) {
                console.log(`[Step ${p.step}] Turn ${p.turns} (seq: ${p.seq}, decode tokens: ${p.decodeTokens || 0})`);
              }
            }
          });
          if (values.json) {
            console.log(JSON.stringify(turnRes, null, 2));
          } else {
            console.log('\n=== Goal Execution Result ===');
            console.log(turnRes.text);
          }
        }
        break;
      }

      case 'plan': {
        const sessionId = positionals[0];
        if (!sessionId) throw new Error('Usage: dsh-worker plan <session-id> [on|off|<prompt>] [--wait]');

        const planAction = positionals.slice(1).join(' ').trim();
        if (!planAction || planAction === 'status') {
          const plan = await client.getPlan(sessionId);
          if (values.json) {
            console.log(JSON.stringify(plan, null, 2));
          } else if (!plan) {
            console.log(`ℹ️ Plan mode is not active for session ${sessionId}.`);
            console.log(`  Enable with: dsh-worker plan ${sessionId} on`);
          } else {
            console.log(`=== Plan Mode Status: ${sessionId} ===`);
            console.log(`State: ${JSON.stringify(plan)}`);
          }
          break;
        }

        const res = await client.setPlan(sessionId, planAction);
        if (values.json && !values.wait) {
          console.log(JSON.stringify(res, null, 2));
        } else if (!values.wait) {
          console.log(`✓ Plan command dispatched to session ${sessionId}. Accepted: ${res?.accepted}`);
        }

        if (values.wait) {
          if (!values.json) console.log(`Waiting for plan response on session ${sessionId}...`);
          const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : undefined;
          const turnRes = await client.waitForCompletion(sessionId, {
            timeoutMs,
            cancelOnTimeout: values['cancel-on-timeout'],
            onProgress: (p) => {
              if (!values.json) {
                console.log(`[Step ${p.step}] Turn ${p.turns} (seq: ${p.seq})`);
              }
            }
          });
          if (values.json) {
            console.log(JSON.stringify(turnRes, null, 2));
          } else {
            console.log('\n=== Plan Result ===');
            console.log(turnRes.text);
          }
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE.trim());
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
