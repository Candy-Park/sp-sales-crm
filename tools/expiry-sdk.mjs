import {createClient as realClient} from '../node_modules/@supabase/supabase-js/dist/index.mjs';
import {pinExpirySession} from './expiry-auth.mjs';

export function createClient(url, key, options) {
  const banner = document.createElement('aside');
  banner.id = 'expiry-test-banner';
  banner.setAttribute('role', 'status');
  banner.textContent = '실제 토큰 만료 검수 전용 · 이 탭에서 로그인하세요. 업무 저장은 차단됩니다.';
  document.body.prepend(banner);
  let deadline = null, triggered = false, finished = false;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const path = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (path?.startsWith('/api/') && response.status === 401 && triggered) {
      finished = true;
      banner.textContent = '실제 만료 후 API 401 확인 · 로그인 복귀와 업무 화면 정리는 별도로 검수합니다.';
    } else if (path?.startsWith('/api/') && triggered && !finished) {
      finished = true;
      banner.textContent = `만료 시점 인증 확인 HTTP ${response.status} · 401이 아니므로 실제 만료 검수는 미완료입니다.`;
    }
    return response;
  };
  const client = pinExpirySession(realClient(url, key, {
    ...options, auth: {...options?.auth, autoRefreshToken: false, persistSession: false},
  }), expires => {
    if (!Number.isFinite(expires)) {
      deadline = null;
      banner.textContent = '만료 시각을 확인하지 못했습니다. 실제 만료 검수는 미완료입니다.';
      return;
    }
    deadline = expires * 1000 + 65000;
    triggered = false;
    finished = false;
  });
  setInterval(() => {
    if (!deadline || finished) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    banner.textContent = `실제 만료 검수 · 자동 갱신 없음 · 인증 확인까지 ${remaining}초 · 탭을 새로고침하지 마세요.`;
    if (!remaining && !triggered && !document.getElementById('workspace').hidden) {
      triggered = true;
      document.getElementById('nav-dashboard').click();
    }
  }, 1000);
  return client;
}
