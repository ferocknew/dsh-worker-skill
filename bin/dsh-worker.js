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
  dsh-worker run --workspace <path> --prompt <text> [--file <path>] [--wait] [--json]
  dsh-worker status <session-id> [--json]
  dsh-worker logs <session-id> [--limit <n>] [--json]

Options:
  --host        DSH Host (default: $DSH_HOST or http://localhost:53080)
  --token       DSH Token (default: $DSH_TOKEN)
  --json        Output raw JSON response
  --wait        Wait for agent execution to complete
  --file        Attach a local file to the session prompt
  --help, -h    Show this help message
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
