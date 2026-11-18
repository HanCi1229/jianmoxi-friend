import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const endpoint = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const model = 'qwen-audio-3.1-tts-flash';

export function qwenSpeechConfig() {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const voice = process.env.FRIEND_QWEN_VOICE_ID?.trim();
  return apiKey && voice?.startsWith(model + '-') ? { apiKey, voice } : null;
}

export function synthesizeQwenSpeech(text, { config, format = 'pcm', signal, onAudio }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const socket = new WebSocket(endpoint, {
      handshakeTimeout: 8000,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
      headers: { Authorization: 'Bearer ' + config.apiKey }
    });
    const id = randomUUID().replace(/-/g, '');
    let finished = false;
    let receivedAudio = false;
    const deadline = setTimeout(() => finish(new Error('SynthesisTimeout')), 18000);
    const abort = () => finish(signal.reason);
    const task = (action, payload) => socket.send(JSON.stringify({
      header: { action, task_id: id, streaming: 'duplex' }, payload
    }));

    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      if (error) reject(error);
      else resolve();
    }

    signal?.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(new Error('SynthesisConnectionError')));
    socket.on('close', () => finish(new Error('SynthesisClosed')));
    socket.on('open', () => task('run-task', {
      task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model,
      parameters: { text_type: 'PlainText', voice: config.voice, format, sample_rate: 24000 },
      input: {}
    }));
    socket.on('message', (data, binary) => {
      if (finished) return;
      try {
        if (binary) {
          if (data.length) {
            receivedAudio = true;
            onAudio(data);
          }
          return;
        }
        const { header } = JSON.parse(data.toString());
        if (!header || header.task_id !== id) return;
        switch (header.event) {
          case 'task-started':
            task('continue-task', { input: { text } });
            task('finish-task', { input: {} });
            break;
          case 'task-failed':
            finish(new Error(header.error_code || 'SynthesisFailed'));
            break;
          case 'task-finished':
            finish(receivedAudio ? undefined : new Error('NoAudio'));
            break;
        }
      } catch (error) {
        finish(error);
      }
    });
  });
}
