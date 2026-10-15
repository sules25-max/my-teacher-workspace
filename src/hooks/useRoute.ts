import { useEffect, useState } from 'react';

// GitHub Pages 하위 경로에서도 새로고침이 깨지지 않도록 해시 라우팅을 사용한다.

export interface Route {
  name: string;
  params: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '') || 'today';
  const [path, qs = ''] = raw.split('?');
  const [name, ...params] = path.split('/').filter(Boolean);
  return { name: name || 'today', params: params.map(decodeURIComponent), query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  const next = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (window.location.hash !== next) window.location.hash = next;
}

export function getCurrentRoute(): Route {
  return parse();
}
