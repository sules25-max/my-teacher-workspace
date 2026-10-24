import type { ReactElement } from 'react';

/** AI가 돌려준 간단한 마크다운("## 제목", "- 항목")을 안전하게(HTML 해석 없이) 보여준다 */
export function RichText({ text }: { text: string }) {
  const blocks = text.split('\n');
  const out: ReactElement[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    out.push(
      <ul key={`ul${k}`} className="rich__list">
        {list.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  blocks.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^\s*[-•*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-•*]\s+/, ''));
      return;
    }
    flush(i);
    if (/^#{1,4}\s+/.test(line)) out.push(<h4 key={i} className="rich__h title-font">{line.replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '')}</h4>);
    else if (line.trim()) out.push(<p key={i}>{line.replace(/\*\*/g, '')}</p>);
  });
  flush(blocks.length);
  return <div className="rich">{out}</div>;
}
