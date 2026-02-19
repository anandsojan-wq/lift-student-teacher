import { env } from '../config/env.js';
import { AutomationLog } from '../models/AutomationLog.js';

function clip(value, max = 1800) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

async function logAutomation(payload) {
  try {
    await AutomationLog.create(payload);
  } catch (error) {
    if (env.nodeEnv !== 'production') {
      console.warn('automation log failed:', error.message);
    }
  }
}

export async function triggerAutomation({
  eventType,
  institutionId = null,
  triggerRole = 'system',
  payload = {}
}) {
  if (!eventType) {
    return {
      status: 'skipped',
      reason: 'Missing eventType.'
    };
  }

  if (!env.automationEnabled || !env.automationWebhookUrl) {
    await logAutomation({
      institutionId,
      eventType,
      triggerRole,
      status: 'skipped',
      destination: 'webhook',
      requestPayload: payload,
      errorMessage: !env.automationEnabled
        ? 'AUTOMATION_ENABLED is false.'
        : 'AUTOMATION_WEBHOOK_URL is not configured.'
    });

    return {
      status: 'skipped',
      reason: !env.automationEnabled
        ? 'Automation disabled.'
        : 'Webhook URL missing.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, env.automationTimeoutMs));

  const body = {
    eventType,
    emittedAt: new Date().toISOString(),
    payload
  };

  try {
    const response = await fetch(env.automationWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.automationWebhookSecret
          ? { 'x-lift-automation-secret': env.automationWebhookSecret }
          : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const responseText = clip(await response.text());
    clearTimeout(timeout);

    const status = response.ok ? 'sent' : 'failed';
    await logAutomation({
      institutionId,
      eventType,
      triggerRole,
      status,
      destination: 'webhook',
      requestPayload: payload,
      responseStatus: response.status,
      responseBody: responseText,
      errorMessage: response.ok ? '' : `Non-2xx response (${response.status}).`
    });

    return {
      status,
      httpStatus: response.status,
      responseBody: responseText
    };
  } catch (error) {
    clearTimeout(timeout);
    const message = error?.name === 'AbortError' ? 'Automation webhook timeout.' : error.message;

    await logAutomation({
      institutionId,
      eventType,
      triggerRole,
      status: 'failed',
      destination: 'webhook',
      requestPayload: payload,
      errorMessage: clip(message, 300)
    });

    return {
      status: 'failed',
      reason: message
    };
  }
}
