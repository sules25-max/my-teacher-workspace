import type { AIProviderId, Settings } from '../../types';
import { callAppsScript, getAppsScriptConfig } from '../google/appsScriptClient';

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIContext {
  label: string; // "현재 페이지: 이번 주 수업 12개"
  text: string; // 실제로 전송되는 최소한의 데이터
}

/**
 * AI 제공자 어댑터. API 키는 프런트엔드에 두지 않는다.
 * Gemini/OpenAI 호출은 Apps Script가 PropertiesService에 저장된 키로 대신 수행한다.
 */
export interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  available(): Promise<boolean>;
  chat(messages: AIMessage[], context: AIContext | null): Promise<string>;
}

const SYSTEM = [
  '너는 초등 영어 교사의 개인 업무수첩 안에 사는 비서 "AI 이나"야.',
  '짧고 친근한 반말로, 3~5문장 이내로 답해.',
  '주어진 자료 밖의 사실은 지어내지 말고 모르면 모른다고 해.',
  '데이터를 직접 바꿀 수 없어. 바꿀 일이 있으면 "빠른 작업에서 확인 후 반영할 수 있어"라고 안내해.',
].join(' ');

class AppsScriptProxyProvider implements AIProvider {
  constructor(
    readonly id: 'gemini' | 'openai',
    readonly label: string,
    private model?: string,
  ) {}
  async available() {
    return !!(await getAppsScriptConfig()) && navigator.onLine;
  }
  async chat(messages: AIMessage[], context: AIContext | null) {
    const res = await callAppsScript<{ text: string }>(
      'aiChat',
      { provider: this.id, model: this.model, system: SYSTEM, context: context?.text ?? '', messages: messages.slice(-8) },
      undefined,
      60000,
    );
    return res.text;
  }
}

/** 외부 전송 없이 기기 안에서만 동작하는 기본 제공자 */
export const localProvider: AIProvider = {
  id: 'local',
  label: '기기 안 비서 (외부 전송 없음)',
  async available() {
    return false;
  },
  async chat() {
    return '';
  },
};

export function getAIProvider(s: Settings): AIProvider {
  switch (s.ai.provider) {
    case 'gemini':
      return new AppsScriptProxyProvider('gemini', 'Gemini (Apps Script 경유)', s.ai.model);
    case 'openai':
      return new AppsScriptProxyProvider('openai', 'OpenAI (Apps Script 경유)', s.ai.model);
    default:
      return localProvider;
  }
}
