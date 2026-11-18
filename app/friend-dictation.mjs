import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = process.env.FRIEND_SPEECH_DIR || '/opt/jianmoxi-friend/speech';
const python = join(runtime, 'venv/bin/python');
const model = join(runtime, 'model');
const worker = fileURLToPath(new URL('./dictation.py', import.meta.url));
const formats = new Map([
  ['audio/webm', 'matroska'], ['audio/mp4', 'mov'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav']
]);
const maxBytes = 768 * 1024;
const recent = new Map();
let running = false;

function failure(message, status) {
  return Object.assign(new Error(message), { status });
}

export function dictationAvailable() {
  return existsSync(python) && existsSync(join(model, 'model.int8.onnx')) && existsSync(join(model, 'tokens.txt'));
}

export async function transcribe(req, account) {
  if (!dictationAvailable()) throw failure('语音转写暂未启用', 503);
  const format = formats.get(req.headers['content-type']?.split(';')[0]?.trim().toLowerCase());
  if (!format) throw failure('暂不支持这种录音格式', 415);
  if (Number(req.headers['content-length']) > maxBytes) throw failure('录音太长，请分段输入', 413);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw failure('录音太长，请分段输入', 413);
    chunks.push(chunk);
  }
  if (!bytes) throw failure('没有收到录音', 400);
  if (running) throw failure('正在处理另一段录音，请稍后重试', 429);
  const now = Date.now();
  for (const [id, times] of recent) {
    const live = times.filter(time => now - time < 60000);
    if (live.length) recent.set(id, live);
    else recent.delete(id);
  }
  const times = recent.get(account) || [];
  if (times.length >= 10) throw failure('转写次数过多，请稍候再试', 429);
  recent.set(account, [...times, now]);
  running = true;
  try {
    const audio = Buffer.concat(chunks, bytes);
    const result = await new Promise((resolve, reject) => {
      const child = execFile(python, [worker, model, format], { timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 32768 }, (error, stdout) => {
        if (error) return reject(failure('语音转写暂时失败，请重试这段录音', 503));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(failure('语音转写暂时失败，请重试这段录音', 503)); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(audio);
    });
    if (result.error) throw failure(result.error, 422);
    if (!result.text) throw failure('没有听清，请靠近麦克风再说一次', 422);
    return { text: result.text.slice(0, 700) };
  } finally {
    running = false;
  }
}
