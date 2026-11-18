import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const path = '/api/friend/call/live';
const endpoint = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const callDuration = 15 * 60 * 1000;
const maxAudioMessage = 1024 * 1024;
const activeCalls = new Set();

function encode(event, sessionId, data = {}) {
  const audio = Buffer.isBuffer(data);
  const payload = audio ? data : Buffer.from(JSON.stringify(data));
  const id = Buffer.from(sessionId || '');
  const frame = Buffer.allocUnsafe(12 + (id.length ? 4 + id.length : 0) + payload.length);
  frame.set([0x11, audio ? 0x24 : 0x14, audio ? 0 : 0x10, 0]);
  frame.writeUInt32BE(event, 4);
  let offset = 8;
  if (id.length) {
    frame.writeUInt32BE(id.length, offset);
    id.copy(frame, offset + 4);
    offset += 4 + id.length;
  }
  frame.writeUInt32BE(payload.length, offset);
  payload.copy(frame, offset + 4);
  return frame;
}

function decode(frame) {
  if (frame.length < 8 || frame[0] !== 0x11) throw new Error('实时语音数据格式错误');
  const type = frame[1] >> 4;
  const flags = frame[1] & 15;
  let offset = 4;
  const number = () => { const value = frame.readUInt32BE(offset); offset += 4; return value; };
  if (type === 15) return { error: number() };
  if (flags & 3) number();
  const event = flags & 4 ? number() : 0;
  if (event >= 50) {
    const idLength = number();
    offset += idLength;
  }
  const size = number();
  if (size > maxAudioMessage || offset + size !== frame.length) throw new Error('实时语音数据长度错误');
  let data = frame.subarray(offset);
  if ((frame[2] & 15) === 1) data = gunzipSync(data, { maxOutputLength: maxAudioMessage });
  if (frame[2] >> 4 === 1) data = JSON.parse(data.toString());
  return { event, data };
}

function dialogOptions(profile) {
  return {
    tts: {
      speaker: 'S_nxM4bNzl2',
      audio_config: { format: 'pcm_s16le', sample_rate: 24000, channel: 1 }
    },
    dialog: {
      bot_name: '小溪',
      system_role: ['你是笺墨溪 Friend 里陪伴用户写作与阅读的小溪。', (profile?.persona || '').slice(0, 2000)].filter(Boolean).join('\n'),
      speaking_style: ['用自然的中文口语回应。先说一两句短话，给对方留接话的空当。只说电话里会说出口的话。', (profile?.style || '').slice(0, 1000)].filter(Boolean).join('\n'),
      extra: { model: '1.2.1.1', input_mod: 'keep_alive' }
    }
  };
}

function relayCall(browser, WebSocket, account, apiKey) {
  const id = randomUUID();
  const voice = new WebSocket(endpoint, {
    maxPayload: maxAudioMessage, handshakeTimeout: 8000, perMessageDeflate: false,
    headers: { 'X-Api-Key': apiKey, 'X-Api-Resource-Id': 'volc.speech.dialog', 'X-Api-Connect-Id': randomUUID() }
  });
  let ready = false;
  let acceptAudio = false;
  let finished = false;
  let answer = '';
  let questionId = '';
  const startup = setTimeout(() => fail('豆包实时语音连接超时，请重试。'), 12000);
  const limit = setTimeout(() => stop('本次通话已达到时长上限。'), callDuration);

  function tell(type, text) {
    if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify({ type, text }));
  }
  function stop(message) {
    if (finished) return;
    finished = true;
    clearTimeout(startup);
    clearTimeout(limit);
    activeCalls.delete(account.id);
    if (message) tell('ended', message);
    if (voice.readyState === WebSocket.OPEN) {
      if (ready) voice.send(encode(102, id));
      voice.send(encode(2));
      voice.close();
    } else if (voice.readyState === WebSocket.CONNECTING) voice.terminate();
    if (browser.readyState === WebSocket.OPEN) browser.close();
  }
  function fail(message) {
    tell('error', message);
    stop();
  }

  browser.on('error', () => stop());
  browser.on('close', () => stop());
  browser.on('message', (data, binary) => {
    if (!ready || finished || !binary || data.length !== 640) return;
    if (voice.bufferedAmount > 64000) return fail('语音上传积压，请重试。');
    voice.send(encode(200, id, data));
  });

  voice.on('open', () => voice.send(encode(1)));
  voice.on('error', () => fail('豆包实时语音暂时无法连接，请重试。'));
  voice.on('close', () => stop('豆包语音连接已结束。'));
  voice.on('message', frame => {
    if (finished) return;
    try {
      const { event, data, error } = decode(frame);
      if (error || event === 51 || event === 153 || event === 599) {
        const code = Number(data?.status_code) || Number(data?.code) || error || event;
        console.warn('豆包实时语音错误', code);
        return fail(ready ? '豆包实时语音中断，请重新拨打。' : '豆包未能开启小溪的语音会话，请检查音色和服务权限。');
      }
      switch (event) {
        case 50: voice.send(encode(100, id, dialogOptions(account.profile))); break;
        case 150: ready = true; clearTimeout(startup); tell('ready'); break;
        case 152: stop('通话已结束。'); break;
        case 350: acceptAudio = true; tell('speaking'); break;
        case 352:
          if (acceptAudio && Buffer.isBuffer(data) && browser.readyState === WebSocket.OPEN) {
            if (browser.bufferedAmount > maxAudioMessage) return fail('语音播放积压，请重试。');
            browser.send(data);
          }
          break;
        case 359: acceptAudio = false; tell('listening'); break;
        case 450:
          acceptAudio = false;
          answer = '';
          questionId = data?.question_id || '';
          tell('interrupt');
          break;
        case 451: {
          const result = data?.results?.[0];
          if (typeof result?.text === 'string' && result.text.trim()) tell('transcript', result.text);
          break;
        }
        case 459: tell('thinking'); break;
        case 550:
          if ((!questionId || !data?.question_id || data.question_id === questionId) && typeof data?.content === 'string') {
            answer = (answer + data.content).slice(-1000);
            tell('reply', answer);
          }
          break;
        case 559:
          if (!questionId || !data?.question_id || data.question_id === questionId) tell('reply-ended');
          break;
      }
    } catch {
      fail('实时语音数据未能处理，请重试。');
    }
  });
}

export function attachRealtimeCalls(server, authenticate) {
  let webSockets;
  server.on('upgrade', async (req, socket, head) => {
    const reject = status => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const checkSocket = () => socket.destroy();
    socket.on('error', checkSocket);
    if (req.url !== path) return reject('404 Not Found');
    if (req.headers.origin !== (process.env.FRIEND_PUBLIC_ORIGIN || 'http://' + req.headers.host)) return reject('403 Forbidden');
    const apiKey = process.env.FRIEND_DOUBAO_API_KEY?.trim();
    if (!apiKey) return reject('503 Service Unavailable');
    try {
      const account = await authenticate(req);
      if (!account) return reject('401 Unauthorized');
      const { default: WebSocket, WebSocketServer } = await import('ws');
      if (socket.destroyed || !socket.writable) return;
      if (activeCalls.has(account.id)) return reject('409 Conflict');
      webSockets ||= new WebSocketServer({ noServer: true, maxPayload: 640, perMessageDeflate: false });
      webSockets.handleUpgrade(req, socket, head, browser => {
        socket.off('error', checkSocket);
        activeCalls.add(account.id);
        try { relayCall(browser, WebSocket, account, apiKey); }
        catch { activeCalls.delete(account.id); browser.close(1011); }
      });
    } catch {
      reject('502 Bad Gateway');
    }
  });
}
