import { randomUUID } from 'node:crypto';

const callPath = '/api/friend/call/live';
const apiHost = 'wss://dashscope.aliyuncs.com/api-ws/v1/';
const realtimeUrl = apiHost + 'realtime?model=qwen-audio-3.1-realtime-flash';
const synthesisUrl = apiHost + 'inference';
const synthesisModel = 'qwen-audio-3.1-tts-flash';
const callDuration = 15 * 60 * 1000;
const maxAudioMessage = 1024 * 1024;
const activeCalls = new Set();

function sendJson(socket, data) {
  socket.send(JSON.stringify(data));
}

function closeSocket(socket, WebSocket) {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  else if (socket?.readyState === WebSocket.CONNECTING) socket.terminate();
}

function relayCall(browser, WebSocket, account, apiKey, voiceId) {
  const socketOptions = {
    maxPayload: maxAudioMessage,
    handshakeTimeout: 8000,
    perMessageDeflate: false,
    headers: { Authorization: 'Bearer ' + apiKey }
  };
  const conversation = new WebSocket(realtimeUrl, socketOptions);
  let current = null;
  let ready = false;
  let closed = false;
  const startup = setTimeout(() => fail('千问实时语音连接超时，请重试。'), 12000);
  const limit = setTimeout(() => stop('本次通话已达到时长上限。'), callDuration);

  function tell(type, text) {
    if (browser.readyState === WebSocket.OPEN) sendJson(browser, { type, text });
  }

  function clearTurn() {
    const previous = current;
    current = null;
    if (!previous) return;
    clearTimeout(previous.transcriptTimer);
    clearTimeout(previous.synthesisTimer);
    closeSocket(previous.synthesis, WebSocket);
  }

  function stop(message) {
    if (closed) return;
    closed = true;
    clearTimeout(startup);
    clearTimeout(limit);
    clearTurn();
    activeCalls.delete(account.id);
    if (message) tell('ended', message);
    closeSocket(conversation, WebSocket);
    closeSocket(browser, WebSocket);
  }

  function fail(message, code) {
    if (closed) return;
    if (typeof code === 'string' && /^[\w.-]{1,80}$/.test(code)) console.warn('千问语音错误', code);
    tell('error', message);
    stop();
  }

  function playReply(turn) {
    if (current !== turn || turn.synthesisStarted || !turn.reply) return;
    clearTimeout(turn.transcriptTimer);
    const synthesis = new WebSocket(synthesisUrl, socketOptions);
    turn.synthesisStarted = true;
    turn.synthesis = synthesis;
    turn.synthesisTimer = setTimeout(() => fail('小溪的语音合成超时，请重试。'), 18000);
    const taskId = randomUUID().replace(/-/g, '');
    const task = (action, payload) => sendJson(synthesis, { header: { action, task_id: taskId, streaming: 'duplex' }, payload });
    const synthesisFailed = code => {
      if (current === turn && turn.synthesis === synthesis) fail('千问未能生成小溪的声音，请重试。', code);
    };
    synthesis.on('error', () => synthesisFailed());
    synthesis.on('close', () => synthesisFailed());
    synthesis.on('open', () => task('run-task', {
      task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: synthesisModel,
      parameters: { text_type: 'PlainText', voice: voiceId, format: 'pcm', sample_rate: 24000 },
      input: {}
    }));
    synthesis.on('message', (data, binary) => {
      if (current !== turn || turn.synthesis !== synthesis) return;
      if (binary) {
        if (browser.readyState !== WebSocket.OPEN) return;
        if (browser.bufferedAmount > maxAudioMessage) return fail('语音播放积压，请重试。');
        if (!turn.speaking) {
          turn.speaking = true;
          tell('reply', turn.reply);
          tell('speaking');
        }
        browser.send(data);
        return;
      }
      try {
        const { header } = JSON.parse(data.toString());
        if (header.task_id !== taskId) return;
        if (header.event === 'task-started') {
          task('continue-task', { input: { text: turn.reply } });
          task('finish-task', { input: {} });
        } else if (header.event === 'task-failed') {
          synthesisFailed(header.error_code);
        } else if (header.event === 'task-finished') {
          if (!turn.speaking) return synthesisFailed('NoAudio');
          clearTimeout(turn.synthesisTimer);
          turn.synthesis = null;
          synthesis.close();
          tell('reply-ended');
          tell('listening');
        }
      } catch {
        synthesisFailed('InvalidSynthesisEvent');
      }
    });
  }

  browser.on('error', () => stop());
  browser.on('close', () => stop());
  browser.on('message', (data, binary) => {
    if (!ready || closed || !binary || data.length !== 640) return;
    if (conversation.bufferedAmount > 64000) return fail('语音上传积压，请重试。');
    sendJson(conversation, { type: 'input_audio_buffer.append', audio: data.toString('base64') });
  });

  conversation.on('open', () => sendJson(conversation, {
    type: 'session.update',
    session: {
      modalities: ['text'],
      input_audio_format: 'pcm',
      input_audio_transcription: { language: 'zh' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 850 },
      instructions: [
        '你是笺墨溪 Friend 里陪伴用户写作与阅读的小溪。',
        (account.profile?.persona || '').slice(0, 2000),
        '用自然的中文口语回应。说一两句短话，给对方留接话的空当。只说电话里会说出口的话。',
        (account.profile?.style || '').slice(0, 1000)
      ].filter(Boolean).join('\n')
    }
  }));
  conversation.on('error', () => fail('千问实时语音暂时无法连接，请重试。'));
  conversation.on('close', () => stop('千问语音连接已结束。'));
  conversation.on('message', data => {
    if (closed) return;
    try {
      const event = JSON.parse(data.toString());
      switch (event.type) {
        case 'session.updated':
          if (!ready) {
            ready = true;
            clearTimeout(startup);
            tell('ready');
          }
          break;
        case 'input_audio_buffer.speech_started':
          clearTurn();
          current = { inputId: event.item_id };
          tell('interrupt');
          break;
        case 'input_audio_buffer.committed':
          if (current && current.inputId === event.item_id) {
            current.committed = true;
            tell('thinking');
          }
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (current && current.inputId === event.item_id) {
            current.transcribed = true;
            if (typeof event.transcript === 'string' && event.transcript.trim()) {
              tell('transcript', event.transcript);
              tell('thinking');
            }
            playReply(current);
          }
          break;
        case 'response.created':
          if (current?.committed) current.responseId = event.response?.id;
          break;
        case 'response.text.done':
          if (current?.responseId && current.responseId === event.response_id) {
            current.reply = event.text?.trim().slice(0, 1000);
            if (!current.reply) { tell('listening'); break; }
            if (current.transcribed) playReply(current);
            else {
              const turn = current;
              turn.transcriptTimer = setTimeout(() => playReply(turn), 900);
            }
          }
          break;
        case 'response.done':
          if (current?.responseId === event.response?.id && event.response?.status === 'failed') {
            fail('千问回复失败，请重新拨打。', event.response?.status_details?.error?.code);
          }
          break;
        case 'error':
          fail('千问实时语音暂时不可用，请重试。', event.error?.code);
          break;
      }
    } catch {
      fail('实时语音数据未能处理，请重试。', 'InvalidConversationEvent');
    }
  });
}

export function attachRealtimeCalls(server, authenticate) {
  let webSockets;
  server.on('upgrade', async (req, socket, head) => {
    const reject = status => socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const checkSocket = () => socket.destroy();
    socket.on('error', checkSocket);
    if (req.url !== callPath) return reject('404 Not Found');
    if (req.headers.origin !== (process.env.FRIEND_PUBLIC_ORIGIN || 'http://' + req.headers.host)) return reject('403 Forbidden');
    const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
    const voiceId = process.env.FRIEND_QWEN_VOICE_ID?.trim();
    if (!apiKey || !voiceId?.startsWith(synthesisModel + '-')) return reject('503 Service Unavailable');
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
        try { relayCall(browser, WebSocket, account, apiKey, voiceId); }
        catch { activeCalls.delete(account.id); browser.close(1011); }
      });
    } catch {
      reject('502 Bad Gateway');
    }
  });
}
