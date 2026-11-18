import { createHash, createHmac, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const host = 'trtc.tencentcloudapi.com';
const calls = new Map();
const lifetime = 15 * 60;

function unavailable(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

function sign(key, text) {
  return createHmac('sha256', key).update(text).digest();
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function userSig(sdkAppId, userId, key) {
  const time = Math.floor(Date.now() / 1000);
  const fields = {
    'TLS.identifier': userId, 'TLS.sdkappid': sdkAppId,
    'TLS.time': time, 'TLS.expire': lifetime + 60
  };
  const signature = sign(key, Object.entries(fields).map(([name, value]) => name + ':' + value + '\n').join(''));
  return deflateSync(JSON.stringify({ 'TLS.ver': '2.0', ...fields, 'TLS.sig': signature.toString('base64') }))
    .toString('base64').replaceAll('+', '*').replaceAll('/', '-').replaceAll('=', '_');
}

async function tencent(action, parameters) {
  const contentType = 'application/json; charset=utf-8';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = date + '/trtc/tc3_request';
  const algorithm = 'TC3-HMAC-SHA256';
  const body = JSON.stringify(parameters);
  const canonical = ['POST', '/', '', 'content-type:' + contentType + '\nhost:' + host + '\n', 'content-type;host', hash(body)].join('\n');
  const key = sign(sign(sign('TC3' + process.env.TRTC_SECRET_KEY, date), 'trtc'), 'tc3_request');
  const signature = sign(key, [algorithm, timestamp, scope, hash(canonical)].join('\n')).toString('hex');
  const response = await fetch('https://' + host, {
    method: 'POST', body, signal: AbortSignal.timeout(12000),
    headers: {
      'Content-Type': contentType,
      Authorization: algorithm + ' Credential=' + process.env.TRTC_SECRET_ID + '/' + scope +
        ', SignedHeaders=content-type;host, Signature=' + signature,
      'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2019-07-22', 'X-TC-Region': process.env.TRTC_REGION || 'ap-guangzhou'
    }
  });
  const result = (await response.json()).Response;
  if (!response.ok || !result || result.Error) {
    console.error('TRTC', action, result?.Error?.Code || response.status, result?.RequestId || '');
    throw unavailable('腾讯语音服务暂时无法处理通话，请稍后重试。', 502);
  }
  return result;
}

export async function startFriendCall(account, voice) {
  const sdkAppId = Number(process.env.TRTC_APP_ID);
  const appKey = process.env.TRTC_APP_KEY;
  const apiKey = process.env.FRIEND_CALL_LLM_KEY;
  const voices = {
    gentle: process.env.TRTC_VOICE_GENTLE || 'v-female-R2s4N9qJ',
    bright: process.env.TRTC_VOICE_BRIGHT || 'v-female-U8aT2yLf',
    mature: process.env.TRTC_VOICE_MATURE || 'v-female-C8k4NxL6'
  };
  if (!Number.isSafeInteger(sdkAppId) || sdkAppId <= 0 || !appKey || !apiKey ||
      !process.env.TRTC_SECRET_ID || !process.env.TRTC_SECRET_KEY) {
    throw unavailable('实时电话尚未配置，请联系管理员。');
  }
  if (!Object.hasOwn(voices, voice)) throw unavailable('这个音色暂不可用，请换一个试试。', 400);
  if (calls.has(account)) throw unavailable('已有一通电话正在连接或通话中。', 409);

  const id = randomUUID().replaceAll('-', '');
  const strRoomId = 'friend_' + id;
  const userId = 'friend_user_' + id;
  const botId = 'friend_bot_' + id;
  const userToken = userSig(sdkAppId, userId, appKey);
  const active = { id };
  calls.set(account, active);
  try {
    const { TaskId } = await tencent('StartAIConversation', {
      SdkAppId: sdkAppId, RoomId: strRoomId, RoomIdType: 1, SessionId: id,
      AgentConfig: {
        UserId: botId, UserSig: userSig(sdkAppId, botId, appKey),
        TargetUserId: userId, MaxIdleTime: 60, InterruptMode: 0, InterruptSpeechDuration: 500
      },
      STTConfig: { Language: '16k_zh_en', VadSilenceTime: 650, VadLevel: 3 },
      LLMConfig: JSON.stringify({
        LLMType: 'openai', Model: process.env.FRIEND_CALL_LLM_MODEL || 'deepseek-flash',
        APIKey: apiKey, APIUrl: process.env.FRIEND_CALL_LLM_URL || 'https://api.deepseek.com/chat/completions',
        Streaming: true, History: 10, HistoryMode: 1, Timeout: 10,
        ExtraBody: { thinking: { type: 'disabled' } },
        SystemPrompt: '你是笺墨溪 Friend 的陪伴伙伴小溪，正在和用户打电话。按上下文自然接话。每次先说一两句短句，能够追问、安慰或分享想法，保持生活化口吻。用标点区分停顿，避免长段落、列表、舞台动作和情绪标签。'
      }),
      TTSConfig: JSON.stringify({ TTSType: 'flow', Model: 'flow_02_turbo', VoiceId: voices[voice], Language: 'zh' })
    });
    if (!TaskId) throw unavailable('腾讯语音服务未返回通话信息。', 502);
    active.taskId = TaskId;
    active.timer = setTimeout(() => {
      void stopFriendCall(account, id).catch(() => {});
    }, lifetime * 1000);
    active.timer.unref();
    return { id, sdkAppId, strRoomId, userId, botId, userSig: userToken };
  } catch (error) {
    calls.delete(account);
    throw error;
  }
}

export async function stopFriendCall(account, id) {
  const active = calls.get(account);
  if (!active?.taskId || active.id !== id) return;
  if (!active.stopping) {
    active.stopping = tencent('StopAIConversation', { TaskId: active.taskId }).finally(() => {
      clearTimeout(active.timer);
      calls.delete(account);
    });
  }
  await active.stopping;
}
